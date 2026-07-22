/**
 * Tick Engine — Market-Data Durable Object
 *
 * Handles real-time market data ingestion from Tradovate, sequencing/de-duplication,
 * and distribution to consumers (Execution Engine, Analytics, Archive).
 *
 * State: Persistent across restarts (Cloudflare Durable Objects guarantee).
 * One instance per instrument (ES, ZN, GC, SPX, etc.)
 */

export class TickEngine {
  constructor(state, env) {
    this.state = state;
    this.env = env;

    // Initialize state storage
    this.tickRingBuffer = [];
    this.ringBufferIndex = 0;
    this.RING_BUFFER_SIZE = 10000;

    this.lastTickId = -1;
    this.lastTimestamp = -1;
    this.subscribers = new Set();
    this.pendingBatches = [];

    // Rate limiting
    this.ticksInWindow = 0;
    this.tickWindow = Math.floor(Date.now() / 1000);
    this.p_ticket = null;
    this.p_time = null;

    // Archive tracking
    this.archiveBuffer = [];
    this.lastArchivedTime = Date.now();
    this.ARCHIVE_FLUSH_INTERVAL = 5 * 60 * 1000; // 5 minutes
    this.ARCHIVE_FLUSH_SIZE = 10000;

    // Initialize ring buffer
    for (let i = 0; i < this.RING_BUFFER_SIZE; i++) {
      this.tickRingBuffer[i] = null;
    }
  }

  /**
   * Handle incoming WebSocket connection from a client
   * (e.g., Execution Engine requesting live price updates)
   */
  async handleWebSocketMessage(ws, message) {
    const data = JSON.parse(message);

    switch (data.type) {
      case 'subscribe':
        this.subscribers.add(ws);
        ws.send(JSON.stringify({ type: 'subscribed', instrument: this.instrument }));
        break;
      case 'unsubscribe':
        this.subscribers.delete(ws);
        break;
      default:
        break;
    }
  }

  /**
   * Main entry point: receive raw tick from Tradovate
   * Caller: TradovateClient after parsing MD socket frame
   */
  async ingestTick(rawTick) {
    // Rate limiting check
    const now = Math.floor(Date.now() / 1000);
    if (now !== this.tickWindow) {
      this.tickWindow = now;
      this.ticksInWindow = 0;
    }
    this.ticksInWindow++;

    // Check penalty ticket
    if (this.p_ticket) {
      const elapsed = (Date.now() - this.p_time) / 1000;
      if (elapsed < 30) {
        console.warn(`[TickEngine] Penalty ticket active for ${Math.ceil(30 - elapsed)}s`);
        return; // Drop this tick
      } else {
        this.p_ticket = null; // Ticket expired
      }
    }

    // De-duplicate: skip if we've seen this tick ID before
    if (rawTick.id && rawTick.id === this.lastTickId) {
      return;
    }

    // Normalize: convert raw Tradovate format to canonical Tick
    const tick = this.normalizeTick(rawTick);

    // Sequence: handle out-of-order ticks
    const sequenced = this.sequenceTick(tick);
    if (!sequenced) {
      return; // Tick was buffered; not ready to emit yet
    }

    // Emit to subscribers (real-time distribution)
    this.broadcastTick(tick);

    // Archive: buffer for R2 flush
    this.archiveBuffer.push(tick);
    this.maybeFlushArchive();
  }

  /**
   * Normalize Tradovate raw format to canonical Tick
   *
   * Input formats:
   * - Quote: {symbol, bid, bidSize, ask, askSize, last, lastSize}
   * - DOM: {bids: [{price, size}], offers: [{price, size}]}
   * - Chart (delta-encoded): {id, bt, bp, ticks: [{t, p, s}]}
   */
  normalizeTick(rawTick) {
    const timestamp = rawTick.timestamp || Date.now();

    let normalizedTick = {
      timestamp,
      source: rawTick.source || 'unknown',
      sequence: this.lastTickId + 1,
    };

    // From Quote (L1)
    if (rawTick.last !== undefined) {
      normalizedTick.price = rawTick.last;
      normalizedTick.size = rawTick.lastSize || 1;
      normalizedTick.bid = rawTick.bid;
      normalizedTick.bidSize = rawTick.bidSize;
      normalizedTick.ask = rawTick.ask;
      normalizedTick.askSize = rawTick.askSize;
    }
    // From DOM (L2)
    else if (rawTick.bids && rawTick.offers) {
      normalizedTick.price = rawTick.offers[0]?.price || (rawTick.bids[0]?.price);
      normalizedTick.size = 1; // DOM doesn't provide tick sizes
      normalizedTick.bidLevels = rawTick.bids;
      normalizedTick.askLevels = rawTick.offers;
    }
    // From Chart (ticks)
    else if (rawTick.ticks) {
      // Caller provides array of ticks from delta-encoded packet
      // (handled upstream; this function gets individual normalized ticks)
      normalizedTick.price = rawTick.price;
      normalizedTick.size = rawTick.size;
      normalizedTick.id = rawTick.id;
    }

    return normalizedTick;
  }

  /**
   * Sequence out-of-order ticks
   *
   * Strategy:
   * - If tick.timestamp >= lastTimestamp: append (in-order)
   * - If tick.timestamp < lastTimestamp: buffer and re-sort
   * - Emit sorted batches periodically (every 100ms)
   */
  sequenceTick(tick) {
    if (tick.timestamp >= this.lastTimestamp) {
      // In-order: immediately append and update high watermark
      this.lastTimestamp = tick.timestamp;
      this.lastTickId = tick.sequence;
      return tick; // Ready to emit
    } else {
      // Out-of-order: buffer for later sorting
      this.pendingBatches.push(tick);

      // Emit sorted batch if buffer is large enough
      if (this.pendingBatches.length >= 100) {
        return this.flushSortedBatch();
      }
      return null; // Not ready yet
    }
  }

  /**
   * Sort and emit pending out-of-order ticks
   */
  flushSortedBatch() {
    if (this.pendingBatches.length === 0) return null;

    // Sort by timestamp
    this.pendingBatches.sort((a, b) => a.timestamp - b.timestamp);

    // Emit batch
    for (const tick of this.pendingBatches) {
      if (tick.timestamp >= this.lastTimestamp) {
        this.lastTimestamp = tick.timestamp;
        this.lastTickId = tick.sequence;
        this.broadcastTick(tick);
      }
    }

    this.pendingBatches = [];
    return this.pendingBatches[0] || null;
  }

  /**
   * Broadcast tick to all subscribers
   */
  broadcastTick(tick) {
    const message = JSON.stringify({
      type: 'tick',
      tick,
      state: {
        bid: tick.bid,
        ask: tick.ask,
        bidSize: tick.bidSize,
        askSize: tick.askSize,
      }
    });

    for (const ws of this.subscribers) {
      try {
        ws.send(message);
      } catch (e) {
        this.subscribers.delete(ws);
      }
    }
  }

  /**
   * Flush archive buffer to R2 and D1
   */
  async maybeFlushArchive() {
    const now = Date.now();
    const timeSinceFlush = now - this.lastArchivedTime;
    const shouldFlush =
      this.archiveBuffer.length >= this.ARCHIVE_FLUSH_SIZE ||
      timeSinceFlush >= this.ARCHIVE_FLUSH_INTERVAL;

    if (shouldFlush) {
      await this.flushArchive();
    }
  }

  async flushArchive() {
    if (this.archiveBuffer.length === 0) return;

    const instrument = this.instrument; // Set by caller
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const hour = String(new Date().getHours()).padStart(2, '0');

    // Key: instruments/{{ symbol }}/{{ date }}/{{ hour }}.ndjson
    const r2Key = `instruments/${instrument}/${date}/${hour}.ndjson`;

    // Convert buffer to NDJSON
    const ndjson = this.archiveBuffer
      .map(tick => JSON.stringify(tick))
      .join('\n') + '\n';

    try {
      // Write to R2
      await this.env.R2_BUCKET.put(r2Key, ndjson);

      // Update D1 index
      const count = this.archiveBuffer.length;
      const firstTick = this.archiveBuffer[0];
      const lastTick = this.archiveBuffer[this.archiveBuffer.length - 1];

      await this.env.DB.prepare(`
        INSERT INTO ticks_index (date, instrument, start_time, end_time, tick_count, first_price, last_price, r2_key, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'complete')
      `).bind(
        date,
        instrument,
        new Date(firstTick.timestamp).toISOString(),
        new Date(lastTick.timestamp).toISOString(),
        count,
        firstTick.price,
        lastTick.price,
        r2Key
      ).run();

      console.log(`[TickEngine] Archived ${count} ticks to ${r2Key}`);
      this.archiveBuffer = [];
      this.lastArchivedTime = Date.now();
    } catch (e) {
      console.error(`[TickEngine] Archive flush failed:`, e);
      // Don't clear buffer; retry on next flush
    }
  }

  /**
   * API: Get latest tick (for /api/quote endpoint)
   */
  async getLatestTick() {
    if (this.ringBufferIndex === 0) return null;

    const idx = (this.ringBufferIndex - 1) % this.RING_BUFFER_SIZE;
    return this.tickRingBuffer[idx];
  }

  /**
   * API: Replay ticks within a time range
   * Called by: Learning Loop (for backtest), Chronometer (for post-session analysis)
   */
  async replayTicks(startTime, endTime) {
    const date = new Date(startTime).toISOString().split('T')[0];
    const instrument = this.instrument;

    // Query D1 for R2 keys in date range
    const rows = await this.env.DB.prepare(`
      SELECT r2_key FROM ticks_index
      WHERE instrument = ? AND date = ? AND start_time >= ? AND end_time <= ?
      ORDER BY start_time ASC
    `).bind(instrument, date, new Date(startTime).toISOString(), new Date(endTime).toISOString()).all();

    // Fetch and parse NDJSON from each key
    const ticks = [];
    for (const row of rows.results) {
      const ndjson = await this.env.R2_BUCKET.get(row.r2_key);
      const text = await ndjson.text();

      for (const line of text.trim().split('\n')) {
        if (line) {
          const tick = JSON.parse(line);
          if (tick.timestamp >= startTime && tick.timestamp <= endTime) {
            ticks.push(tick);
          }
        }
      }
    }

    return ticks;
  }

  /**
   * Fetch (RPC call from client)
   * Routes requests to appropriate handler
   */
  async fetch(request) {
    const { pathname, searchParams } = new URL(request.url);

    if (pathname === '/ws') {
      // WebSocket upgrade
      const { 0: client, 1: server } = Object.values(new WebSocketPair());
      server.accept();

      server.addEventListener('message', (e) => this.handleWebSocketMessage(server, e.data));

      return new Response(null, { status: 101, webSocket: client });
    }

    if (pathname === '/tick') {
      // Ingest raw tick
      const data = await request.json();
      await this.ingestTick(data);
      return new Response(JSON.stringify({ ok: true }));
    }

    if (pathname === '/latest') {
      // Get latest tick
      const tick = await this.getLatestTick();
      return new Response(JSON.stringify(tick || {}));
    }

    if (pathname === '/replay') {
      // Replay ticks in range
      const startTime = Number(searchParams.get('start'));
      const endTime = Number(searchParams.get('end'));
      const ticks = await this.replayTicks(startTime, endTime);
      return new Response(JSON.stringify(ticks));
    }

    return new Response('Not Found', { status: 404 });
  }
}

export default TickEngine;
