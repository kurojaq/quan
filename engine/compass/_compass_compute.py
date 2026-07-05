# embedded compute: ingest two chains, build two-session RIPN/SOP/fold/ZC for the canvas tool
import numpy as np, json, tempfile, os
import quan_engine as E, quan_realization as R

def _ripn_raw(path, anchor, n=11):
    fr = E.ingest_chain(path)
    strikes, ap = R._ap_per_strike(fr)
    strikes = np.asarray(strikes, float); ab = np.abs(np.asarray(ap, float))
    if anchor is None or anchor=='' :
        row = int(len(strikes)//2)               # fallback: median strike
    else:
        row = int(np.argmin(np.abs(strikes-float(anchor))))
    fin = np.isfinite(ab); lo,hi = (ab[fin].min(), ab[fin].max()) if fin.any() else (0.0,0.0)
    ripn = np.where(fin, (ab-lo)/(hi-lo) if hi>lo else 0.0, 0.0)
    win = np.array([ripn[row+j] if row+j < len(ripn) else 0.0 for j in range(n)])
    return win, float(strikes[row]), fr, row

def _sop_layers(fr, row):
    W = R.realization_waves(fr, None, anchor_idx=row)
    g=np.array(W['sopG'],float); c=np.array(W['sopC'],float); J=np.array(W['fold'],float)
    tens=np.array([J[i]+(J[i+1] if i+1<len(J) else 0) for i in range(len(J))])
    return dict(product=J,gradient=g,curvature=c,tension=tens)

def compute(prev_text, prev_anchor, cur_text, cur_anchor):
    pp=os.path.join(tempfile.gettempdir(),'_prev.csv'); open(pp,'w').write(prev_text)
    cp=os.path.join(tempfile.gettempdir(),'_cur.csv');  open(cp,'w').write(cur_text)
    prev_raw, ps, frP, rowP = _ripn_raw(pp, prev_anchor)
    cur_raw,  cs, frC, rowC = _ripn_raw(cp, cur_anchor)
    LP=_sop_layers(frP,rowP); LC=_sop_layers(frC,rowC)
    cur_off=(cur_raw-cur_raw[0]); prev_off=(prev_raw-prev_raw[0])
    overlaps=[int(k) for k in range(11) if cur_off[k]*prev_off[k]>1e-12]
    def series(key):
        pv=LP[key]; cu=LC[key]
        x=list(-1+np.arange(0,10)*0.1)+list(np.arange(0,11)*0.1); y=list(pv[0:10])+list(cu[0:11]); return x,y
    sop={}
    for key in ['product','curvature','gradient','tension']:
        x,y=series(key); sop[key]=[[round(float(a),4),round(float(b),5)] for a,b in zip(x,y)]
    xp,yp=series('product'); o=np.argsort(xp); xs=np.array(xp)[o]; ys=np.array(yp)[o]
    zc=[round(float((xs[i-1]+xs[i])/2),3) for i in range(1,len(ys)) if ys[i-1]!=0 and ys[i]!=0 and (ys[i-1]<0)!=(ys[i]<0)]
    return json.dumps({
      'prev_anchor':(None if prev_anchor in (None,'') else float(prev_anchor)),
      'cur_anchor':(None if cur_anchor in (None,'') else float(cur_anchor)),
      'prev_strike':round(ps),'cur_strike':round(cs),
      'ripn_prev':[round(float(v),5) for v in (prev_raw-prev_raw[10])],
      'ripn_cur':[round(float(v),5) for v in cur_off],
      'fold_cur':[round(float(v),5) for v in cur_off],'fold_prev':[round(float(v),5) for v in prev_off],
      'overlaps':overlaps,'sop':sop,'zc':zc,
    })
