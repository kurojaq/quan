(function(){
  // ---- client-view Report rendering: same field groups as js/report.js, fed from a published snapshot instead of a live engine call ----
  var GROUPS=[
   ['Structural Field Read (live)', [['ATM (Δ≈0.50)','atm'],['Net GEX (γ×OI)','netgexraw'],['Gamma-Wall Cluster','gwall'],['Put Shelf','putshelf'],['Deep OI Shelf','oishelf'],['CL lobe (PC/PG)','clstate'],['CM lobe (PG/PC)','cmstate'],['Breach-C watch (CT)','breachc']]],
   ['Field Classification', [['Field Type','fieldType'],['Surface Intensity','intensity'],['Cascade Grade','cascadeGrade'],['Skew Convergence','skewConv'],['Trigger Pull TP','tp'],['CDS (Composite)','cds'],['CDS Interpretation','cdsi']]],
   ['Session Breach Clock — points of interest', [['Coherence-break ZC','zc'],['9th-order intersections','poly9'],['Tension intersections (CL×CM)','tensx'],['CL coherence-break (CT)','breachc'],['ZC count','zcn']]],
   ['Three-Phase Skewness Cascade', [['Intent DIDS','dids'],['Transaction DITS','dits'],['Realization DR3S','dr3s']]],
   ['Three-Phase Kurtosis', [['Intent DIDK','didk'],['Transaction DITK','ditk'],['Realization DR3K','dr3k']]],
   ['Chronometric Speeds', [['Speed of Intent SoI','soi'],['Chronometric Speed Cs','cs'],['Speed of Transaction SoT','sot'],['Speed of Realization SoR','sor']]],
   ['Greeks Exposure', [['Net DDE','netdde'],['Dollar DDE ($)','dollardde'],['Net GEX ($)','netgex'],['Net Vega ($)','netvega'],['Net Theta ($)','nettheta']]],
   ['IV Surface', [['ATM IV (Δ≈0.5)','atmiv'],['25Δ Risk Reversal','rr25'],['25Δ Butterfly','bf25'],['Smile Slope dσ/dK','smile']]],
   ['Risq — Structural Confidence', [['Risq Ratio ℛₓ','risqRatio'],['Risq Tier','risqTier']]],
   ['Context', [['Forward Price F','fwd'],['Days to Expiry T','dte'],['Active Strikes (IV)','activestk']]]
  ];
  // Deliberately omitted from the client view: the five raw Risq dimensions, the Deep
  // Strike Scorecard table, and the Fibonacci quarter-level table — those are operator-
  // side position-sizing/execution mechanics (Layer A/B/C entries), not the structural
  // read itself. See js/report.js for the full operator view.
  function esc(s){ return String(s==null?'':s).replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c];}); }
  function card(label,val){ var v=(val==null||val==='')?'<span class="rdash">—</span>':esc(val);
    return '<div class="rcard"><div class="rk">'+esc(label)+'</div><div class="rv">'+v+'</div></div>'; }
  window.__viewRenderReport=function(container, data){
    if(!container) return;
    if(!data){ container.innerHTML='<div class="rptSub">No report published for this date.</div>'; return; }
    var html='';
    for(var i=0;i<GROUPS.length;i++){ var g=GROUPS[i];
      html+='<div class="rgroup"><div class="rgt">'+esc(g[0])+'</div><div class="rcards">';
      for(var j=0;j<g[1].length;j++){ var f=g[1][j]; html+=card(f[0], data[f[1]]); }
      html+='</div></div>';
    }
    if(data.breakdown){ html+='<div class="rptBreakdown"><div class="rgt">Analysis &amp; Execution Breakdown</div>'+data.breakdown+'</div>'; }
    container.innerHTML=html;
  };
})();
