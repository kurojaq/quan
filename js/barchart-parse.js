/* Qu'an robust Barchart ingestion layer (Spec #2, Increment 2).
 *
 * Header-driven parsing of Barchart options-chain CSVs, replacing the fragile
 * hard-coded column indices that broke on instruments whose export layout
 * differs from equity futures (notably ZN / Treasury options).
 *
 * Handles both raw Barchart "side-by-side" exports (duplicate column names —
 * first occurrence = call, second = put, split by the Strike column, mirroring
 * pandas' `.1` duplicate suffixing used by quan_engine.ingest_chain) AND
 * explicitly-named layouts ("Call OI" / "Put OI"). Falls back to the legacy
 * positional layout only when no headers can be recognised, and reports which
 * path + column map it used through the pipeline diagnostics bus (__qPipe).
 *
 * Output row shape: {k, coi, poi, cvol, pvol, cprem, pprem, clatest, platest}
 * (identical to the legacy detector.js / heatmap.html parsers).
 */
(function(global){
  'use strict';

  function splitCSV(line){ var out=[],cur='',q=false;
    for(var i=0;i<line.length;i++){ var ch=line[i];
      if(ch==='"'){ q=!q; } else if(ch===','&&!q){ out.push(cur); cur=''; } else cur+=ch; }
    out.push(cur); return out; }

  function num(s){ if(s==null) return null;
    s=String(s).trim().replace(/^"|"$/g,'').replace(/,/g,'').replace(/s$/,'');
    if(s===''||/^n\/?a$/i.test(s)||s==='--') return null;
    var v=parseFloat(s); return isFinite(v)?v:null; }

  function norm(h){ return String(h==null?'':h).replace(/^﻿/,'').trim().toLowerCase().replace(/"/g,''); }

  // Classify one header cell -> {field, side}. side: 'c' | 'p' | null (ambiguous).
  function analyze(h){
    var n=norm(h), side=null, field=null;
    if(/\bcall\b|\(c\)|^c[\s_-]/.test(n)) side='c';
    else if(/\bput\b|\(p\)|^p[\s_-]/.test(n)) side='p';
    if(/strike/.test(n)) field='strike';
    else if(/open\s*int|(^|[^a-z])oi([^a-z]|$)/.test(n)) field='oi';
    else if(/volume|(^|[^a-z])vol([^a-z]|$)/.test(n)) field='vol';
    else if(/premium|(^|[^a-z])prem([^a-z]|$)/.test(n)) field='prem';
    else if(/latest|(^|[^a-z])last([^a-z]|$)/.test(n)) field='latest';
    return {field:field, side:side};
  }

  // Build a column-index map from the classified header row.
  function buildMap(classified){
    var strikeIdxs=[], byField={oi:[],vol:[],prem:[],latest:[]};
    for(var i=0;i<classified.length;i++){ var a=classified[i]; if(!a.field) continue;
      if(a.field==='strike') strikeIdxs.push(i);
      else if(byField[a.field]) byField[a.field].push({idx:i, side:a.side}); }
    if(!strikeIdxs.length) return null;
    var strikeIdx=strikeIdxs[Math.floor((strikeIdxs.length-1)/2)]; // middle Strike if several
    function assign(list){
      var c=null,p=null;
      list.forEach(function(x){ if(x.side==='c'&&c==null)c=x.idx; else if(x.side==='p'&&p==null)p=x.idx; });
      if(c==null||p==null){
        var left=list.filter(function(x){return x.idx<strikeIdx&&x.side==null;});
        var right=list.filter(function(x){return x.idx>strikeIdx&&x.side==null;});
        if(c==null&&left.length) c=left[0].idx;
        if(p==null&&right.length) p=right[right.length-1].idx;
        if(c==null||p==null){ var un=list.filter(function(x){return x.side==null;}).map(function(x){return x.idx;});
          if(c==null&&un.length) c=un[0]; if(p==null&&un.length>1) p=un[1]; }
      }
      return {c:c,p:p};
    }
    var oi=assign(byField.oi), vol=assign(byField.vol), prem=assign(byField.prem), lat=assign(byField.latest);
    return { strike:strikeIdx, coi:oi.c, poi:oi.p, cvol:vol.c, pvol:vol.p,
             cprem:prem.c, pprem:prem.p, clatest:lat.c, platest:lat.p };
  }

  function parseChainHeader(text){
    var lines=text.replace(/\r/g,'').split('\n').filter(function(l){return l.trim()!=='';});
    if(lines.length<2) return null;
    var rawHdr=splitCSV(lines[0]);
    var map=buildMap(rawHdr.map(analyze));
    if(!map) return null;
    // core fields must all resolve, or this isn't a chain we can trust header-wise
    if(map.coi==null||map.poi==null||map.cprem==null||map.pprem==null||map.cvol==null||map.pvol==null) return null;
    var rows=[];
    for(var i=1;i<lines.length;i++){ var v=splitCSV(lines[i]); if(v.length<=map.strike) continue;
      var k=num(v[map.strike]); if(k==null) continue;
      rows.push({ k:k,
        coi:num(v[map.coi]), poi:num(v[map.poi]), cvol:num(v[map.cvol]), pvol:num(v[map.pvol]),
        cprem:num(v[map.cprem]), pprem:num(v[map.pprem]),
        clatest:map.clatest!=null?num(v[map.clatest]):null,
        platest:map.platest!=null?num(v[map.platest]):null }); }
    rows.sort(function(a,b){return a.k-b.k;});
    return { rows:rows, map:map, headers:rawHdr };
  }

  // Legacy fixed layout:
  //   Type,Last,Volume,"Open Int","Daily Premium",Strike,Type,Last,Volume,"Open Int","Daily Premium"
  function parseChainPositional(text){
    var lines=text.replace(/\r/g,'').split('\n').filter(function(l){return l.trim()!=='';});
    var rows=[];
    for(var i=1;i<lines.length;i++){ var v=splitCSV(lines[i]); if(v.length<11) continue;
      var k=num(v[5]); if(k==null) continue;
      rows.push({ k:k, cprem:num(v[4]), pprem:num(v[10]), coi:num(v[3]), poi:num(v[9]),
        cvol:num(v[2]), pvol:num(v[8]), clatest:num(v[1]), platest:num(v[7]) }); }
    rows.sort(function(a,b){return a.k-b.k;});
    return rows;
  }

  function describeMap(hd){ var H=hd.headers, m=hd.map;
    function nm(i){ return (i!=null&&H[i]!=null)?String(H[i]).trim():'?'; }
    return {strike:nm(m.strike), coi:nm(m.coi), poi:nm(m.poi),
            cprem:nm(m.cprem), pprem:nm(m.pprem), cvol:nm(m.cvol), pvol:nm(m.pvol)}; }

  // Public: header-driven with positional fallback + diagnostics.
  function parseChain(text, ctx){
    var hd=null; try{ hd=parseChainHeader(text); }catch(_){ hd=null; }
    if(hd && hd.rows && hd.rows.length){
      if(global.__qPipe) global.__qPipe.log('Chain Parse','ok',null,ctx,{mode:'header-driven', strikes:hd.rows.length, columns:describeMap(hd)});
      return hd.rows;
    }
    var pos=[]; try{ pos=parseChainPositional(text); }catch(_){ pos=[]; }
    if(global.__qPipe) global.__qPipe.log('Chain Parse', pos.length?'warn':'fail',
      pos.length?'header detection failed — used legacy positional layout; verify columns for this export'
               :'could not parse chain by header or position',
      ctx, {mode:'positional-fallback', strikes:pos.length});
    return pos;
  }

  // Convenience: keyed-by-strike object map {K:{coi,cprem,cvol,poi,pprem,pvol}} for the heatmap surface.
  function parseChainMap(text, ctx){
    var rows=parseChain(text, ctx), m={};
    for(var i=0;i<rows.length;i++){ var r=rows[i];
      m[r.k]={coi:r.coi, cprem:r.cprem, cvol:r.cvol, poi:r.poi, pprem:r.pprem, pvol:r.pvol}; }
    return m;
  }

  global.QuanBarchart={
    parseChain:parseChain, parseChainMap:parseChainMap,
    parseChainHeader:parseChainHeader, parseChainPositional:parseChainPositional,
    num:num, splitCSV:splitCSV, analyze:analyze, buildMap:buildMap
  };
})(typeof window!=='undefined'?window:globalThis);
