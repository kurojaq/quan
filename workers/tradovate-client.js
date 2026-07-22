/**
 * Tradovate MD Socket Client
 *
 * Handles WebSocket connection to Tradovate market-data endpoint.
 * Implements SockJS-style frame protocol + reconnection logic.
 *
 * Usage:
 *   const client = new TradovateClient(mdAccessToken, tickEngineUrl);
 *   client.on('tick', (tick) => handleTick(tick));
 *   await client.connect();
 *   await client.subscribeQuote('ESZ26');
 */

export class TradovateClient {
  constructor(mdAccessToken, tickEngineUrl, instrument) {
    this.mdAccessToken = mdAccessToken;
    this.tickEngineUrl = tickEngineUrl;
    this.instrument = instrument;

    this.ws = null;
    this.requestId = 0;
    this.pendingRequests = new Map();
    this.reconnectAttempts = 0;
    this.MAX_RECONNECT_ATTEMPTS = 10;
    this.RECONNECT_BACKOFF = 5000; // 5 seconds, exponential

    this.subscriptionIds = new Map(); // Map of endpoint -> subscription id
    this.heartbeatInterval = null;
    this.eventHandlers = new Map();

    this.baseTimestamp = Math.floor(Date.now());
    this.basePrice = 0;
  }

  /**
   * Connect to Tradovate MD socket (wss://md.tradovateapi.com/v1/websocket)
   */
  async connect() {
    try {
      const url = 'wss://md.tradovateapi.com/v1/websocket';
      this.ws = new WebSocket(url);

      this.ws.onopen = () => this.handleOpen();
      this.ws.onmessage = (e) => this.handleMessage(e);
      this.ws.onerror = (e) => this.handleError(e);
      this.ws.onclose = () => this.handleClose();

      console.log(`[TradovateClient] Connecting to ${url}`);
    } catch (e) {
      console.error(`[TradovateClient] Connection failed:`, e);
      this.reconnect();
    }
  }

  /**
   * Handle WebSocket open event
   * Send authorization frame
   */
  handleOpen() {
    console.log(`[TradovateClient] Connected, authorizing...`);

    // Authorize: frame format is `authorize\n<requestId>\n\n<mdAccessToken>`
    const requestId = ++this.requestId;
    const authFrame = `authorize\n${requestId}\n\n${this.mdAccessToken}`;

    this.ws.send(authFrame);
    this.pendingRequests.set(requestId, { type: 'authorize' });

    // Start heartbeat (keep-alive every 2.5 seconds)
    this.startHeartbeat();

    this.reconnectAttempts = 0;
  }

  /**
   * Handle incoming WebSocket message
   * Frame format: a[{...}] (array of messages)
   */
  handleMessage(event) {
    const data = event.data;

    // Parse SockJS frame: a[JSON array]
    if (data === 'o') {
      // Open frame (shouldn't arrive after auth)
      return;
    }
    if (data === 'h') {
      // Heartbeat ping; respond with keep-alive
      this.ws.send('[]');
      return;
    }
    if (data.startsWith('a')) {
      // Data frame: a[...]
      try {
        const jsonStr = data.substring(1); // Remove 'a' prefix
        const messages = JSON.parse(jsonStr);

        for (const msg of messages) {
          if (msg.s !== undefined) {
            // Command reply (status, request ID, data)
            this.handleCommandReply(msg);
          } else if (msg.e === 'md') {
            // Real-time event (market data)
            this.handleMDEvent(msg.d);
          }
        }
      } catch (e) {
        console.error(`[TradovateClient] Failed to parse frame:`, e, data);
      }
      return;
    }
  }

  /**
   * Handle command reply (status 200 = success)
   * Structure: {s: 200, i: requestId, d: {data}}
   */
  handleCommandReply(msg) {
    const { s, i, d } = msg;
    const pending = this.pendingRequests.get(i);

    if (s !== 200) {
      console.error(`[TradovateClient] Command failed (${i}):`, s, d);

      // Check for penalty ticket
      if (d?.p_ticket) {
        console.warn(`[TradovateClient] Penalty ticket: ${d.p_ticket}, backoff: ${d.p_time}s`);
        this.emit('penalty', { p_ticket: d.p_ticket, p_time: d.p_time });
      }

      return;
    }

    if (pending?.type === 'authorize') {
      console.log(`[TradovateClient] Authorized successfully`);
      this.emit('ready');
    } else if (pending?.type === 'subscribe') {
      // Subscription successful; d contains subscription id
      const subId = d?.id;
      const endpoint = pending.endpoint;
      this.subscriptionIds.set(endpoint, subId);
      console.log(`[TradovateClient] Subscribed to ${endpoint} (sub id ${subId})`);
    }

    this.pendingRequests.delete(i);
  }

  /**
   * Handle real-time market-data event
   * Event structure: {id, e: "md", d: {snapshot of quote/dom/chart}}
   */
  handleMDEvent(eventData) {
    // eventData is the raw Tradovate entity (Quote, DOM, Chart, etc.)
    const tick = this.parseMDEvent(eventData);

    if (tick) {
      this.emit('tick', tick);
      this.sendToTickEngine(tick);
    }
  }

  /**
   * Parse Tradovate MD entity into canonical Tick
   */
  parseMDEvent(data) {
    const tick = {
      timestamp: Date.now(),
      source: 'tradovate',
    };

    // Quote entity (L1): {symbol, bid, bidSize, ask, askSize, last, lastSize, ...}
    if (data.last !== undefined) {
      tick.price = data.last;
      tick.size = data.lastSize || 1;
      tick.bid = data.bid;
      tick.bidSize = data.bidSize;
      tick.ask = data.ask;
      tick.askSize = data.askSize;
      tick.source = 'quote';
      return tick;
    }

    // DOM entity (L2): {bids: [...], offers: [...]}
    if (data.bids && data.offers) {
      tick.price = data.offers[0]?.price || data.bids[0]?.price;
      tick.size = 1;
      tick.bidLevels = data.bids;
      tick.askLevels = data.offers;
      tick.source = 'dom';
      return tick;
    }

    // Chart/histogram: caller handles delta decoding upstream
    // This function handles already-normalized tick format
    if (data.price !== undefined) {
      tick.price = data.price;
      tick.size = data.size;
      tick.id = data.id;
      tick.source = data.source || 'chart';
      return tick;
    }

    return null;
  }

  /**
   * Send tick to Tick Engine Durable Object
   */
  async sendToTickEngine(tick) {
    try {
      await fetch(this.tickEngineUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tick)
      });
    } catch (e) {
      console.error(`[TradovateClient] Failed to send to Tick Engine:`, e);
    }
  }

  /**
   * Subscribe to Level 1 Quote (best bid/ask + last trade)
   */
  async subscribeQuote(symbol) {
    const requestId = ++this.requestId;
    const request = `md/subscribeQuote\n${requestId}\n\n${JSON.stringify({ symbol })}`;

    this.pendingRequests.set(requestId, { type: 'subscribe', endpoint: 'quote' });
    this.ws.send(request);
  }

  /**
   * Subscribe to Level 2 DOM (order book depth)
   */
  async subscribeDOM(symbol) {
    const requestId = ++this.requestId;
    const request = `md/subscribeDOM\n${requestId}\n\n${JSON.stringify({ symbol })}`;

    this.pendingRequests.set(requestId, { type: 'subscribe', endpoint: 'dom' });
    this.ws.send(request);
  }

  /**
   * Get Chart (ticks + bars + history)
   * chartDescription: {underlyingType, elementSize, elementSizeUnit, withHistogram}
   * timeRange: {asMuchAsElements} or {closestTimestamp} for backfill
   */
  async getChart(symbol, chartDescription, timeRange) {
    const requestId = ++this.requestId;
    const request = `md/getChart\n${requestId}\n\n${JSON.stringify({
      symbol,
      chartDescription,
      timeRange
    })}`;

    this.pendingRequests.set(requestId, { type: 'subscribe', endpoint: 'chart' });
    this.ws.send(request);
  }

  /**
   * Unsubscribe from Quote
   */
  async unsubscribeQuote(symbol) {
    const subId = this.subscriptionIds.get('quote');
    if (!subId) return;

    const requestId = ++this.requestId;
    const request = `md/unsubscribeQuote\n${requestId}\n\n${JSON.stringify({ symbol })}`;

    this.ws.send(request);
    this.subscriptionIds.delete('quote');
  }

  /**
   * Start heartbeat (keep-alive every 2.5 seconds)
   */
  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send('[]');
      }
    }, 2500);
  }

  /**
   * Stop heartbeat
   */
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Handle WebSocket error
   */
  handleError(e) {
    console.error(`[TradovateClient] WebSocket error:`, e);
    this.emit('error', e);
  }

  /**
   * Handle WebSocket close
   * Attempt reconnection with exponential backoff
   */
  handleClose() {
    console.log(`[TradovateClient] Disconnected (attempt ${this.reconnectAttempts + 1})`);
    this.stopHeartbeat();
    this.reconnect();
  }

  /**
   * Reconnect logic: exponential backoff
   */
  reconnect() {
    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      console.error(`[TradovateClient] Max reconnection attempts reached`);
      this.emit('fatal-error', 'Max reconnect attempts');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.RECONNECT_BACKOFF * Math.pow(2, this.reconnectAttempts - 1);

    console.log(`[TradovateClient] Reconnecting in ${delay}ms...`);
    setTimeout(() => this.connect(), delay);
  }

  /**
   * Event emitter
   */
  on(event, handler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event).push(handler);
  }

  emit(event, data) {
    const handlers = this.eventHandlers.get(event) || [];
    for (const handler of handlers) {
      try {
        handler(data);
      } catch (e) {
        console.error(`[TradovateClient] Event handler error (${event}):`, e);
      }
    }
  }

  /**
   * Close connection
   */
  close() {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
    }
  }
}

export default TradovateClient;
