/* ============================================================================
   Rolling Analysis Engine  —  Forward Dealer Interest Framework
   ----------------------------------------------------------------------------
   An independent analytical service that treats option expirations as a
   continuously evolving term structure rather than isolated daily snapshots.
   It ingests every stored expiration from the warehouse (window.__qStore),
   indexes them by expiry, aggregates dealer positioning across the expiration
   curve with a transparent/configurable weighting model, and computes
   higher-order structural heuristics.

   Concerns are separated (per the spec's architectural requirements):
     parseChain      — data ingestion (canonical CBOE side-by-side layout)
     indexExpirations— expiration indexing + strike-lifecycle observations
     aggregate       — temporal aggregation across the curve
     weightOf        — configurable temporal weighting model
     heuristics      — structural significance / concentration / asymmetry
     termStructure   — per-expiration profile along the time axis

   This slice is the engine + data model only; the expiration-curve
   visualization, rolling Bookmap overlays and rolling reporting consume this
   API in later slices. Everything here is pure, dependency-free JS so it runs
   identically in the browser and under Node for testing.

   Public API:  window.RollingEngine
   ============================================================================ */
(function(root){
  'use strict';

  // ---- canonical option-chain ingestion (columns mirror detector.js) ----------
  function splitCSV(line){ var out=[],cur='',q=false;
    for(var i=0;i<line.length;i++){ var ch=line[i];
      if(ch==='"') q=!q; else if(ch===','&&!q){ out.push(cur); cur=''; } else cur+=ch; }
    out.push(cur); return out; }
  function num(x){ if(x==null) return null; x=String(x).trim().replace(/\s+$/,'');
    if(x===''||x==='N/A'||x==='-') return null; var n=parseFloat(x.replace(/,/g,'')); return isNaN(n)?null:n; }

  // parseChain(text) -> [{k, coi, poi, cvol, pvol, cprem, pprem, oi}] sorted by strike.
  // oi = call OI + put OI (combined dealer interest at the strike).
  function parseChain(text){
    if(!text||typeof text!=='string') return [];
    var L=text.replace(/\r/g,'').trim().split('\n'), rows=[];
    for(var i=1;i<L.length;i++){
      var v=splitCSV(L[i]); if(v.length<11) continue;
      var k=num(v[5]); if(k==null) continue;
      var coi=num(v[3]), poi=num(v[9]);
      rows.push({ k:k, coi:coi, poi:poi, cvol:num(v[2]), pvol:num(v[8]),
                  cprem:num(v[4]), pprem:num(v[10]), oi:(coi||0)+(poi||0) });
    }
    rows.sort(function(a,b){ return a.k-b.k; });
    return rows;
  }

  // ---- expiry-date extraction from a chain filename (best-effort) --------------
  // Recognizes exp-MM_DD_YY / exp-MM-DD-YY / MM_DD_YYYY etc. Returns 'YYYY-MM-DD' or null.
  function expiryFromName(name){
    if(!name) return null;
    var s=String(name);
    var m=s.match(/exp[^0-9]?(\d{1,2})[_\-\/.](\d{1,2})[_\-\/.](\d{2,4})/i)
        || s.match(/(\d{1,2})[_\-\/.](\d{1,2})[_\-\/.](20\d{2}|\d{2})(?!\d)/);
    if(!m) return null;
    var mo=+m[1], da=+m[2], yr=+m[3]; if(yr<100) yr+=2000;
    if(mo<1||mo>12||da<1||da>31) return null;
    return yr+'-'+String(mo).padStart(2,'0')+'-'+String(da).padStart(2,'0');
  }
  function daysBetween(a,b){ // (b - a) in whole days, from 'YYYY-MM-DD'
    var da=Date.parse(a+'T00:00:00Z'), db=Date.parse(b+'T00:00:00Z');
    if(isNaN(da)||isNaN(db)) return null;
    return Math.round((db-da)/86400000);
  }

  // ---- expiration indexing -----------------------------------------------------
  // Walk the warehouse for one instrument and emit one record per stored
  // (sessionDate, expiry) observation. Buckets: Daily / EOM, plus later-dated
  // "survivors" carried on each cell. Each record is a lifecycle observation of
  // an expiration as seen on a given session date.
  function indexExpirations(inst, store){
    store=store||root.__qStore||{};
    var rec=store[inst]; var out=[];
    if(!rec||!rec.sess) return out;
    Object.keys(rec.sess).forEach(function(sessionDate){
      var cell=rec.sess[sessionDate]; if(!cell||!cell.exp) return;
      Object.keys(cell.exp).forEach(function(bucket){
        var e=cell.exp[bucket]; if(!e||!e.chain) return;
        var expiryDate=expiryFromName(e.fn)|| (bucket==='Daily'?sessionDate:null);
        out.push({
          inst:inst, sessionDate:sessionDate, bucket:bucket, fn:e.fn||null,
          expiryDate:expiryDate,
          ttxDays:(expiryDate?daysBetween(sessionDate,expiryDate):null),
          chainText:e.chain, anchor:(cell.anchor!=null?+cell.anchor:null)
        });
      });
    });
    // stable order: by session date, then time-to-expiry
    out.sort(function(a,b){ return (a.sessionDate<b.sessionDate?-1:a.sessionDate>b.sessionDate?1:0)
                                   || ((a.ttxDays||0)-(b.ttxDays||0)); });
    return out;
  }

  // ---- configurable temporal weighting (Objective 7) ---------------------------
  // Transparent, not hard-coded: choose a mode and parameters. Returns a weight
  // in (0, ~1]. Nearer expirations dominate by default (time-decay), but weights
  // can be flattened or driven by open interest / volume instead.
  var DEFAULT_WEIGHTING={ mode:'ttx', tau:21, floor:0.02 };
  function weightOf(obs, w){
    w=w||DEFAULT_WEIGHTING;
    var out=1;
    if(w.mode==='equal') out=1;
    else if(w.mode==='oi'){ out=Math.log1p(obs._totalOI||0); }
    else { // 'ttx' — exponential time-to-expiration decay
      var t=(obs.ttxDays!=null?Math.max(0,obs.ttxDays):(w.tau||21));
      out=Math.exp(-t/(w.tau||21));
    }
    // optional OI reinforcement multiplier, applied on top of any mode
    if(w.oiReinforce && obs._totalOI) out*=(1+Math.log1p(obs._totalOI)/10);
    return Math.max(w.floor||0, out);
  }

  // ---- temporal aggregation across the expiration curve ------------------------
  // aggregate(inst, opts) -> rolling term-structure snapshot as of `asOf`
  //   opts.asOf     : 'YYYY-MM-DD' (default: latest session in the store)
  //   opts.weighting: weighting config (see weightOf)
  //   opts.store    : override warehouse (for testing)
  function aggregate(inst, opts){
    opts=opts||{};
    var all=indexExpirations(inst, opts.store);
    var weighting=opts.weighting||DEFAULT_WEIGHTING;
    if(!all.length) return { inst:inst, asOf:opts.asOf||null, expirations:[], strikes:[], totalOI:0, empty:true };

    var asOf=opts.asOf || all.map(function(o){return o.sessionDate;}).sort().slice(-1)[0];

    // For each distinct expiration, take its most recent observation on/before asOf.
    var byExp={};
    all.forEach(function(o){
      if(o.sessionDate>asOf) return;                       // strict as-of: no look-ahead
      var key=(o.expiryDate||(o.bucket+':'+o.sessionDate));
      var cur=byExp[key];
      if(!cur || o.sessionDate>cur.sessionDate) byExp[key]=o;
    });
    var obsList=Object.keys(byExp).map(function(k){ return byExp[k]; });

    // Parse chains, tag each observation with its own totals (needed by OI weighting).
    obsList.forEach(function(o){
      o._rows=parseChain(o.chainText);
      var t=0; o._rows.forEach(function(r){ t+=r.oi; });
      o._totalOI=t;
    });
    obsList.forEach(function(o){ o._weight=weightOf(o, weighting); });

    // Per-strike term structure: accumulate weighted + raw dealer interest across expirations.
    var strikeMap={};
    obsList.forEach(function(o){
      var expKey=(o.expiryDate||(o.bucket+':'+o.sessionDate));
      o._rows.forEach(function(r){
        var s=strikeMap[r.k]||(strikeMap[r.k]={ strike:r.k, callOI:0, putOI:0, cumOI:0, wOI:0, byExp:[] });
        s.callOI+=(r.coi||0); s.putOI+=(r.poi||0); s.cumOI+=r.oi; s.wOI+=r.oi*o._weight;
        s.byExp.push({ exp:expKey, ttxDays:o.ttxDays, oi:r.oi, weight:o._weight });
      });
    });

    var strikes=Object.keys(strikeMap).map(function(k){ return strikeMap[k]; });
    var totalW=0; strikes.forEach(function(s){ totalW+=s.wOI; });
    var totalOI=0; obsList.forEach(function(o){ totalOI+=o._totalOI; });

    // Per-strike structural measures.
    strikes.forEach(function(s){
      s.expirationCount=s.byExp.length;                                  // in how many expirations this strike carries interest
      s.persistence=s.expirationCount/obsList.length;                    // 0..1 breadth across the curve (Obj 11)
      s.share=totalW>0?(s.wOI/totalW):0;                                 // weighted share of forward interest
      s.putCallSkew=(s.callOI+s.putOI)>0?((s.putOI-s.callOI)/(s.putOI+s.callOI)):0;
    });
    strikes.sort(function(a,b){ return a.strike-b.strike; });

    var expirations=obsList.map(function(o){
      return { key:(o.expiryDate||(o.bucket+':'+o.sessionDate)), sessionDate:o.sessionDate,
               bucket:o.bucket, expiryDate:o.expiryDate, ttxDays:o.ttxDays,
               weight:o._weight, totalOI:o._totalOI,
               oiShare: totalOI>0?(o._totalOI/totalOI):0 };
    }).sort(function(a,b){ return (a.ttxDays==null?1e9:a.ttxDays)-(b.ttxDays==null?1e9:b.ttxDays); });

    return { inst:inst, asOf:asOf, weighting:weighting,
             expirations:expirations, strikes:strikes,
             totalOI:totalOI, totalWeightedOI:totalW,
             expirationCount:obsList.length, strikeCount:strikes.length };
  }

  // ---- structural heuristics (Objective 11) ------------------------------------
  // Interpretable measures of how dealer positioning is distributed across strike
  // and time. Operates on an aggregate() result.
  function heuristics(agg){
    if(!agg||agg.empty||!agg.strikes.length) return { empty:true };
    var strikes=agg.strikes.slice().sort(function(a,b){ return b.wOI-a.wOI; });

    // Concentration: Herfindahl on weighted strike shares (1 = one strike owns everything).
    var hhi=0; strikes.forEach(function(s){ hhi+=s.share*s.share; });

    // Dominant strikes = smallest set covering >= 60% of weighted forward interest.
    var acc=0, dominant=[];
    for(var i=0;i<strikes.length && acc<0.60;i++){ dominant.push(strikes[i]); acc+=strikes[i].share; }

    // Forward positioning asymmetry: weighted mean strike above vs. below the anchor.
    var callW=0,putW=0; agg.strikes.forEach(function(s){ callW+=s.callOI; putW+=s.putOI; });
    var forwardAsymmetry=(callW+putW)>0?((putW-callW)/(putW+callW)):0;   // >0 = put-heavy (downside) forward interest

    // Concentration gradient: how sharply weighted interest falls from the peak strike.
    var peak=strikes[0]||{wOI:0,strike:null};
    var neighborhood=agg.strikes.filter(function(s){ return peak.strike!=null && Math.abs(s.strike-peak.strike)<=Math.max(1,(agg.strikes.length?1:0)); });

    return {
      concentrationHHI:hhi,
      dominantStrikes:dominant.map(function(s){ return { strike:s.strike, share:+s.share.toFixed(4), persistence:+s.persistence.toFixed(3) }; }),
      dominantCoverage:+acc.toFixed(4),
      forwardAsymmetry:+forwardAsymmetry.toFixed(4),
      peakStrike:peak.strike,
      peakShare:+((peak.share||0).toFixed(4)),
      structuralStability:+(agg.strikes.reduce(function(a,s){ return a+s.persistence; },0)/agg.strikes.length).toFixed(3),
      expirationCount:agg.expirationCount
    };
  }

  // ---- per-expiration term profile (feeds the expiration-curve visualization) --
  function termStructure(inst, opts){
    var agg=aggregate(inst, opts);
    return { inst:agg.inst, asOf:agg.asOf,
             points:agg.expirations.map(function(e){
               return { key:e.key, ttxDays:e.ttxDays, totalOI:e.totalOI, weight:e.weight, oiShare:e.oiShare };
             }) };
  }

  root.RollingEngine={
    parseChain:parseChain, expiryFromName:expiryFromName, daysBetween:daysBetween,
    indexExpirations:indexExpirations, weightOf:weightOf, DEFAULT_WEIGHTING:DEFAULT_WEIGHTING,
    aggregate:aggregate, heuristics:heuristics, termStructure:termStructure,
    // convenience: full rolling snapshot for the active instrument
    snapshot:function(inst, opts){ inst=inst||(root.__qCurInst&&root.__qCurInst())||'NQ';
      var agg=aggregate(inst, opts); return { aggregate:agg, heuristics:heuristics(agg), term:termStructure(inst, opts) }; }
  };

  // CommonJS export for Node-based testing
  if(typeof module!=='undefined'&&module.exports) module.exports=root.RollingEngine;

})(typeof window!=='undefined'?window:globalThis);
