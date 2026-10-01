/**
 * #2635 wiring test: after a timeframe round-trip (1d -> 4h -> 1d) the chart
 * viewport must be re-fit on the render that carries the NEW timeframe's data,
 * not on the transitional render where `timeframe` has changed but the candle
 * hook still serves the previous frame. The candle-source mock below lags one
 * effect behind `timeframe`, exactly like useTokenChart/usePercolatorCandles
 * (fetch runs in a post-render effect). Each fitContent() call records the
 * length of the last series.setData() payload, i.e. which frame it fit.
 * Also asserts: live-tick re-renders (same data ref) never re-fit (manual zoom
 * survives) and the scroll-back paging range subscription survives the switch
 * (paging's own trigger is covered in TradingChart.scroll-back-paging.test.tsx).
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => {
  const priceLine = { applyOptions: vi.fn() };
  const seriesPriceScale = { applyOptions: vi.fn() };
  const series = {
    setData: vi.fn((d: unknown[]) => { harness.setLen.set(d.length); }),
    update: vi.fn(),
    applyOptions: vi.fn(),
    createPriceLine: vi.fn(() => priceLine),
    priceScale: vi.fn(() => seriesPriceScale),
    dataByIndex: vi.fn(),
    coordinateToPrice: vi.fn(),
  };
  const chartPriceScale = { applyOptions: vi.fn() };

  // The "current visible range" the mocked chart reports back to the
  // zoom-in/zoom-out handlers — set per-test via harness.visibleRange.
  const timeScale = {
    fitContent: vi.fn(() => { harness.fitLog.push(harness.setLen.get()); }),
    subscribeVisibleLogicalRangeChange: vi.fn(),
    unsubscribeVisibleLogicalRangeChange: vi.fn(),
    getVisibleLogicalRange: vi.fn(() => harness.visibleRange),
    setVisibleLogicalRange: vi.fn(),
    coordinateToLogical: vi.fn(() => null as number | null),
  };
  const pane = { setPreserveEmptyPane: vi.fn() };
  // Real (jsdom) element — useChartZoomControls attaches native
  // addEventListener/removeEventListener + tabIndex to whatever
  // chart.chartElement() returns, same contract ChartDrawingOverlay
  // relies on elsewhere in this component.
  const chartElementDiv = document.createElement('div');
  const chart = {
    panes: vi.fn(() => [pane]),
    applyOptions: vi.fn(),
    remove: vi.fn(),
    removeSeries: vi.fn(),
    addSeries: vi.fn(() => series),
    priceScale: vi.fn(() => chartPriceScale),
    timeScale: vi.fn(() => timeScale),
    subscribeCrosshairMove: vi.fn(),
    unsubscribeCrosshairMove: vi.fn(),
    chartElement: vi.fn(() => chartElementDiv),
    options: vi.fn(() => ({
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { axisPressedMouseMove: { time: true, price: true }, mouseWheel: true, pinch: true },
    })),
  };

  // 200 bars — comfortably past the zoom-out extent clamp for the ranges
  // these tests exercise, so the numbers below match plain
  // center-and-scale arithmetic without also hitting the data-extent
  // clamp (that clamp is covered on its own in chart-zoom.test.ts).
  const percolatorCandles = Array.from({ length: 200 }, (_, index) => ({
    time: 1_720_000_000 + index * 60,
    open: 100 + index * 0.01,
    high: 101 + index * 0.01,
    low: 99 + index * 0.01,
    close: 100.5 + index * 0.01,
    volume: 0,
  }));

  const chartTheme = {
    bg: '#000000',
    textColor: '#ffffff',
    gridColor: '#222222',
    borderColor: '#333333',
    neutralLine: '#999999',
    upColor: '#00ff00',
    downColor: '#ff0000',
    entryLine: '#00ffff',
    volUpColor: '#00ff00',
    volDownColor: '#ff0000',
  };

  // Stable (never-reallocated) empty arrays for the non-winning sources.
  // TradingChart's `lineData` useMemo depends on the RAW dex candle
  // arrays (not just a derived boolean) and its factory re-maps
  // percolatorCandles on every invocation — so if these mocks returned a
  // fresh `[]` literal per call, lineData would get a new reference every
  // render, retrigger the series-rebuild effect's setSeriesEpoch(), and
  // loop forever (OOM). Same stability requirement as
  // TradingChart.scroll-back-paging.test.tsx's `harness.sources.*`.
  const emptyCandles: never[] = [];
  const fitLog: number[] = [];
  let lastSetLen = 0;
  const mk = (n: number, base: number) =>
    Array.from({ length: n }, (_, i) => ({ time: 1_720_000_000 + i * 60, open: base, high: base + 1, low: base - 1, close: base + 0.5, volume: 0 }));
  // bar count per timeframe so a fit can be attributed to a frame
  const byTf: Record<string, ReturnType<typeof mk>> = { '1d': mk(200, 100), '4h': mk(300, 100) };
  const setLen = { get: () => lastSetLen, set: (n: number) => { lastSetLen = n; } };

  return {
    chart,
    timeScale,
    series,
    percolatorCandles,
    emptyCandles,
    fitLog,
    byTf,
    mk,
    setLen,
    chartTheme,
    visibleRange: null as { from: number; to: number } | null,
  };
});

vi.mock('lightweight-charts', () => ({
  createChart: vi.fn(() => harness.chart),
  LineStyle: { Solid: 0, Dashed: 2 },
  ColorType: { Solid: 'solid' },
  CrosshairMode: { Normal: 0 },
  CandlestickSeries: 'CandlestickSeries',
  HistogramSeries: 'HistogramSeries',
  BarSeries: 'BarSeries',
  LineSeries: 'LineSeries',
  AreaSeries: 'AreaSeries',
}));

vi.mock('@/components/providers/SlabProvider', () => ({
  useSlabState: () => ({ config: {}, params: {} }),
}));

vi.mock('@/hooks/useLivePrice', () => ({ useLivePrice: () => ({ priceUsd: 100 }) }));

vi.mock('@/hooks/usePercolatorCandles', async () => {
  const React = await import('react');
  return {
    usePercolatorCandles: (_slab: string | null, tf: string) => {
      const [state, setState] = React.useState({ tf, data: harness.byTf[tf] });
      // Post-render effect, like the real hook's fetch: the render in which
      // `tf` changes still returns the previous frame's array.
      React.useEffect(() => {
        setState((s: { tf: string; data: typeof state.data }) => (s.tf === tf ? s : { tf, data: harness.byTf[tf] }));
      }, [tf]);
      return { candles: state.data, status: 'success' };
    },
  };
});

vi.mock('@/hooks/useTokenChart', () => ({
  useTokenChart: () => ({
    candles: harness.emptyCandles,
    status: 'idle',
    poolAddress: null,
    loadOlder: vi.fn(),
    isLoadingOlder: false,
    hasMoreHistory: true,
  }),
}));

vi.mock('@/hooks/useUserAccount', () => ({ useUserAccount: () => null }));
vi.mock('@/hooks/useMarketConfig', () => ({ useMarketConfig: () => ({}) }));
vi.mock('@/hooks/useMarketInfo', () => ({
  useMarketInfo: () => ({ market: { symbol: 'SOL' } }),
}));
vi.mock('@/hooks/useLiqPrice', () => ({ useLiqPrice: () => null }));
vi.mock('@/hooks/useChartTheme', () => ({ useChartTheme: () => harness.chartTheme }));
vi.mock('@/hooks/useChartStylePref', () => ({ useChartStylePref: () => ['candle-solid', vi.fn()] }));
vi.mock('@/hooks/useChartOverlayPrefs', () => ({
  useChartOverlayPrefs: () => [{ liq: false, entry: false, position: false, pnl: false }, vi.fn()],
}));
vi.mock('@/hooks/useChartIndicatorPrefs', () => ({
  useChartIndicatorPrefs: () => ({
    indicators: [],
    addIndicator: vi.fn(),
    removeIndicator: vi.fn(),
    updateIndicator: vi.fn(),
    clearAll: vi.fn(),
  }),
}));
vi.mock('@/hooks/useChartDrawingTool', () => ({ useChartDrawingTool: () => ({ tool: 'pointer', setTool: vi.fn() }) }));
vi.mock('@/hooks/useChartDrawings', () => ({
  useChartDrawings: () => ({ drawings: [], addDrawing: vi.fn(), deleteDrawing: vi.fn(), clearAll: vi.fn() }),
}));
vi.mock('@/components/trade/useIndicatorOverlays', () => ({ useIndicatorOverlays: vi.fn() }));
vi.mock('@/components/trade/useIndicatorOscillatorPane', () => ({ useIndicatorOscillatorPane: vi.fn() }));
vi.mock('@/lib/priceStore/priceStore', () => ({
  subscribeSlab: vi.fn(() => vi.fn()),
  getSnapshot: vi.fn(() => ({ priceUsd: 100 })),
}));
vi.mock('@/lib/perf/perfTiming', () => ({ startPerfSpan: vi.fn(() => vi.fn()) }));
vi.mock('@/lib/pollWhenVisible', () => ({ pollWhenVisible: vi.fn(() => vi.fn()) }));
vi.mock('@/lib/mock-mode', () => ({ isMockMode: vi.fn(() => false) }));
vi.mock('@/lib/mock-trade-data', () => ({ isMockSlab: vi.fn(() => false), getMockUserAccount: vi.fn(() => null) }));
vi.mock('@/lib/entry-price', () => ({ getEntryPrice: vi.fn(() => 0n) }));
vi.mock('@/components/ui/ShimmerSkeleton', () => ({ ShimmerSkeleton: () => null }));
vi.mock('@/components/trade/ChartStyleMenu', () => ({ ChartStyleMenu: () => null }));
vi.mock('@/components/trade/ChartDisplayMenu', () => ({ ChartDisplayMenu: () => null }));
vi.mock('@/components/trade/ChartPnlBadge', () => ({ ChartPnlBadge: () => null }));
vi.mock('@/components/trade/ChartIndicatorMenu', () => ({ ChartIndicatorMenu: () => null }));
vi.mock('@/components/trade/ChartDrawingOverlay', () => ({ ChartDrawingOverlay: () => null }));
vi.mock('@/components/trade/ChartDrawingToolbar', () => ({ ChartDrawingToolbar: () => null }));
// ChartZoomControls / ChartZoomOverlay are deliberately NOT mocked — they
// (and the useChartZoomControls hook that wires them to the chart) are
// exactly what this file tests.

import { TradingChart } from '@/components/trade/TradingChart';

describe('TradingChart viewport re-fit on timeframe change (#2635)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.fitLog.length = 0;
    harness.byTf['1d'] = harness.mk(200, 100);
    harness.byTf['4h'] = harness.mk(300, 100);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ prices: [] }) })));
  });

  async function renderChart() {
    const utils = render(
      <TradingChart slabAddress="TestSlab1111111111111111111111111111111111" mintAddress="TestMint1111111111111111111111111111111111" />,
    );
    await waitFor(() => expect(harness.fitLog.length).toBeGreaterThan(0));
    return utils;
  }

  it('fits the new frame after 1d -> 4h -> 1d, never the stale transitional frame', async () => {
    const user = userEvent.setup();
    await renderChart();
    expect(harness.fitLog).toEqual([200]);

    await user.click(screen.getByRole('button', { name: '4h' }));
    await waitFor(() => expect(harness.fitLog.length).toBe(2));
    expect(harness.fitLog).toEqual([200, 300]);

    await user.click(screen.getByRole('button', { name: '1d' }));
    await waitFor(() => expect(harness.fitLog.length).toBe(3));
    // pre-fix: the transitional render fit (and claimed the combo) with the
    // stale 300-bar frame, and the real 200-bar frame was never fit.
    expect(harness.fitLog).toEqual([200, 300, 200]);
  });

  it('does not re-fit on live-tick re-renders (manual zoom survives)', async () => {
    const user = userEvent.setup();
    const utils = await renderChart();
    await user.click(screen.getByRole('button', { name: '4h' }));
    await waitFor(() => expect(harness.fitLog.length).toBe(2));
    const before = harness.fitLog.length;
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        utils.rerender(
          <TradingChart slabAddress="TestSlab1111111111111111111111111111111111" mintAddress="TestMint1111111111111111111111111111111111" />,
        );
      });
    }
    expect(harness.fitLog.length).toBe(before);
  });

  it('keeps the scroll-back paging subscription alive across a timeframe change', async () => {
    const user = userEvent.setup();
    await renderChart();
    const subsBefore = harness.timeScale.subscribeVisibleLogicalRangeChange.mock.calls.length;
    expect(subsBefore).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: '4h' }));
    await waitFor(() => expect(harness.fitLog.length).toBe(2));
    // registered once per chart lifetime, not torn down by the timeframe switch
    expect(harness.timeScale.unsubscribeVisibleLogicalRangeChange).not.toHaveBeenCalled();
  });
});
