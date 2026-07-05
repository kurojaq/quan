"""
quan_blackscholes.py — Black-76 Greeks + inverse IV solver, ported VERBATIM from the terminal
(computeStrikeGreeks / impliedVolFromPremium / bs76Price / bs76Vega), which the terminal verified
against numerical derivatives to 1e-9. Lets us COMPUTE Greeks from a chain when no vendor Greeks CSV exists.

Black-76 (futures options): d1=(ln(F/K)+0.5σ²T)/(σ√T), d2=d1-σ√T.
  Call = e^(-rT)[F·N(d1)-K·N(d2)] ; Put = e^(-rT)[K·N(-d2)-F·N(-d1)]
"""
import math

A1, A2, A3, A4, A5, P = 0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429, 0.3275911


def norm_cdf(x):
    sign = -1 if x < 0 else 1
    ax = abs(x) / math.sqrt(2)
    t = 1.0 / (1.0 + P * ax)
    y = 1.0 - (((((A5 * t + A4) * t) + A3) * t + A2) * t + A1) * t * math.exp(-ax * ax)
    return 0.5 * (1.0 + sign * y)


def norm_pdf(x):
    return math.exp(-x * x / 2) / math.sqrt(2 * math.pi)


def strike_greeks(F, K, T, sigma, r):
    """Per-strike Black-76 Greeks. Returns dict or None if degenerate."""
    for v in (F, K, T, sigma, r):
        if not math.isfinite(v):
            return None
    if F <= 0 or K <= 0 or T <= 0 or sigma <= 0:
        return None
    sqrtT = math.sqrt(T); sst = sigma * sqrtT
    d1 = (math.log(F / K) + 0.5 * sigma * sigma * T) / sst
    d2 = d1 - sst
    Nd1, Nd2 = norm_cdf(d1), norm_cdf(d2)
    NmD1, NmD2 = norm_cdf(-d1), norm_cdf(-d2)
    phi = norm_pdf(d1); disc = math.exp(-r * T)
    delta_call = disc * Nd1
    delta_put = -disc * NmD1
    gamma = (disc * phi) / (F * sst)
    vega = F * disc * sqrtT * phi / 100
    dd1_dT = -math.log(F / K) / (2 * sigma * T ** 1.5) + sigma / (4 * sqrtT)
    charm_call = (r * disc * Nd1 - disc * phi * dd1_dT) / 365
    charm_put = (-r * disc * NmD1 - disc * phi * dd1_dT) / 365
    vanna = -disc * phi * d2 / sigma / 100
    return dict(d1=d1, d2=d2, deltaCall=delta_call, deltaPut=delta_put, gamma=gamma, vega=vega,
                charmCall=charm_call, charmPut=charm_put, vanna=vanna)


def bs76_price(F, K, T, sigma, r, typ):
    if T <= 0 or sigma <= 0 or F <= 0 or K <= 0:
        return 0.0
    sst = sigma * math.sqrt(T)
    d1 = (math.log(F / K) + 0.5 * sigma * sigma * T) / sst
    d2 = d1 - sst
    disc = math.exp(-r * T)
    if typ == 'call':
        return disc * (F * norm_cdf(d1) - K * norm_cdf(d2))
    return disc * (K * norm_cdf(-d2) - F * norm_cdf(-d1))


def bs76_vega(F, K, T, sigma, r):
    if T <= 0 or sigma <= 0:
        return 0.0
    sst = sigma * math.sqrt(T)
    d1 = (math.log(F / K) + 0.5 * sigma * sigma * T) / sst
    return F * math.exp(-r * T) * math.sqrt(T) * norm_pdf(d1)


def implied_vol(F, K, T, r, observed_price, typ):
    """Newton-Raphson IV from a price-per-point premium. Returns sigma or None."""
    if not all(math.isfinite(v) for v in (F, K, T, r, observed_price)):
        return None
    if F <= 0 or K <= 0 or T <= 0 or observed_price <= 0:
        return None
    disc = math.exp(-r * T)
    if typ == 'call' and observed_price >= F * disc:
        return None
    if typ == 'put' and observed_price >= K * disc:
        return None
    sigma = 0.20; TOL = 1e-6; SMIN, SMAX = 0.01, 5.0
    for _ in range(25):
        price = bs76_price(F, K, T, sigma, r, typ)
        diff = price - observed_price
        if abs(diff) < TOL:
            return sigma
        vega = bs76_vega(F, K, T, sigma, r)
        if vega < 1e-10:
            sigma += (-1 if diff > 0 else 1) * 0.05
            sigma = max(SMIN, min(SMAX, sigma)); continue
        sigma = sigma - diff / vega
        sigma = max(SMIN, min(SMAX, sigma))
    return None
