# Barchart API Analysis

## Endpoint
```
https://www.barchart.com/proxies/core-api/v1/quotes/get
```

## Common Parameters
| Parameter | Value | Notes |
|-----------|-------|-------|
| `symbol` | BNIN26, BN1Q26, etc. | Weekly code (or contract symbol for monthlies) |
| `list` | `futures.options` | Always this value |
| `groupBy` | `strikePrice` | Group results by strike price |
| `orderBy` | `strikePrice` | Sort by strike price |
| `orderDir` | `asc` | Ascending order |
| `raw` | `1` | Return raw data |
| `meta` | `field.shortName,field.description,field.type` | Include metadata |

## Data Type: Option Prices

**Fields:**
```
optionType, lastPrice, volume, openInterest, premium, strikePrice, longSymbol, symbolName, symbolType
```

**Example URL:**
```
https://www.barchart.com/proxies/core-api/v1/quotes/get?symbol=BNIN26&list=futures.options&fields=optionType%2ClastPrice%2Cvolume%2CopenInterest%2Cpremium%2CstrikePrice%2ClongSymbol%2CsymbolName%2CsymbolType&groupBy=strikePrice&meta=field.shortName%2Cfield.description%2Cfield.type&orderBy=strikePrice&orderDir=asc&raw=1
```

**CSV Columns:**
- Strike
- Type
- Symbol
- LastPrice
- Volume
- OpenInterest
- Premium

## Data Type: Volatility & Greeks

**Fields:**
```
strikePrice, symbolName, baseSymbol, lastPrice, optImpliedVolatility, delta, gamma, theta, vega, impliedVolatilitySkew, optionType, tradeTime, longSymbol, daysToExpiration, expirationDate, averageVolatility
```

**Example URL:**
```
https://www.barchart.com/proxies/core-api/v1/quotes/get?symbol=BNIN26&list=futures.options&fields=strikePrice%2CsymbolName%2CbaseSymbol%2ClastPrice%2CoptImpliedVolatility%2Cdelta%2Cgamma%2Ctheta%2Cvega%2CimpliedVolatilitySkew%2CoptionType%2CtradeTime%2ClongSymbol%2CdaysToExpiration%2CexpirationDate%2CaverageVolatility&groupBy=strikePrice&meta=field.shortName%2Cfield.description%2Cfield.type&orderBy=strikePrice&orderDir=asc&raw=1
```

**CSV Columns:**
- Strike
- Type
- Symbol
- LastPrice
- ImpliedVol
- Delta
- Gamma
- Vega
- Theta
- IVSkew
- TradeTime
- DaysToExp
- AvgVolatility

## Response Format
- Content-Type: `application/json`
- Status: 200 OK
- Data: Array of option objects grouped by strikePrice

## UI Dropdowns (to implement)
1. **Go To** - Data Type (Options Prices / Volatility & Greeks)
2. **Options Type** - Monthly / Weekly with specific codes
3. **Week/Month** - Select specific expiration
4. **Show All** - Moneyness filter (5 Strikes, Near Money, 20 Strikes, etc.)
5. **Side-by-Side** - View type (Split / Stacked)

## No Authentication Required
- Direct CORS calls work from browser
- No cookies or auth headers needed
- Rate limiting unknown
