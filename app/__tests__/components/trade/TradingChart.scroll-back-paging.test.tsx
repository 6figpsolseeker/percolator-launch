/**
 * #2581 — TradingChart wires the chart's visible logical range to
 * useTokenChart's loadOlder(): scrolling/panning to the left edge should
 * page in older DEX/GeckoTerminal history, but ONLY while that source
 * (GeckoTerminal via useTokenChart) is the one actually on screen — panning
 * a Percolator/oracle-fallback chart must never fire a GeckoTerminal
 * request, since only useTokenChart's route supports before_timestamp
 * paging today.
 *
 * Mirrors the mocking pattern in TradingChart.live-source-wiring.test.tsx
 * (a fresh, self-contained harness here rather than importing that file's
 * internal one, so this stays a focused single-concern test file).
 */
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => {
  const priceLine = { applyOptions: vi.fn() };
  const seriesPriceScale = { applyOptions: vi.fn() };
  const series = {
    setData: vi.fn(),
    update: vi.fn(),
    applyOptions: vi.fn(),
    createPriceLine: vi.fn(() => priceLine),
    priceScale: vi.fn(() => seriesPriceScale),
    dataByIndex: vi.fn(),
    coordinateToPrice: vi.fn(),
  };
  const chartPriceScale = { applyOptions: vi.fn() };
  const timeScale = {
    fitContent: vi.fn(),
    subscribeVisibleLogicalRangeChange: vi.fn(),
    unsubscribeVisibleLogicalRangeChange: vi.fn(),
    // Chart zoom (useChartZoomControls): +/-/reset buttons and box-zoom
    // drag read/write the visible logical range and project drag pixels
    // to logical indices.
    getVisibleLogicalRange: vi.fn(() => null as { from: number; to: number } | null),
    setVisibleLogicalRange: vi.fn(),
    coordinateToLogical: vi.fn(() => null as number | null),
  };
  const pane = { setPreserveEmptyPane: vi.fn() };
  // A real (jsdom) element — useChartZoomControls attaches native
  // addEventListener/removeEventListener + reads/writes tabIndex on
  // whatever chart.chartElement() returns.
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

  const percolatorCandles = Array.from({ length: 10 }, (_, index) => ({
    time: 1_720_000_000 + index * 60,
    open: 100 + index,
    high: 101 + index,
    low: 99 + index,
    close: 100.5 + index,
    volume: 0,
  }));

  const sources = {
    percolatorStatus: 'success' as string,
    percolatorCandlesOverride: null as unknown[] | null,
    dexStatus: 'idle' as string,
    dexCandles: [] as unknown[],
  };

  const loadOlder = vi.fn();

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

  return { chart, timeScale, series, percolatorCandles, sources, loadOlder, chartTheme };
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

vi.mock('@/hooks/usePercolatorCandles', () => ({
  usePercolatorCandles: () => ({
    candles: harness.sources.percolatorCandlesOverride ?? harness.percolatorCandles,
    status: harness.sources.percolatorStatus,
  }),
}));

vi.mock('@/hooks/useTokenChart', () => ({
  useTokenChart: () => ({
    candles: harness.sources.dexCandles,
    status: harness.sources.dexStatus,
    poolAddress: null,
    loadOlder: harness.loadOlder,
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

import { TradingChart } from '@/components/trade/TradingChart';

/** Pulls the handler TradingChart registered via
 *  chart.timeScale().subscribeVisibleLogicalRangeChange(handler). */
function getRangeChangeHandler(): (range: { from: number; to: number } | null) => void {
  const call = harness.timeScale.subscribeVisibleLogicalRangeChange.mock.calls.at(-1);
  if (!call) throw new Error('subscribeVisibleLogicalRangeChange was never called');
  return call[0];
}

describe('TradingChart scroll-back paging wiring (#2581)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.sources.percolatorStatus = 'success';
    harness.sources.percolatorCandlesOverride = null;
    harness.sources.dexStatus = 'idle';
    harness.sources.dexCandles = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ prices: [] }) })),
    );
  });

  it('registers a visible-logical-range subscription on the chart', async () => {
    render(<TradingChart slabAddress="TestSlab1111111111111111111111111111111111" mintAddress="TestMint1111111111111111111111111111111111" />);
    await waitFor(() => {
      expect(harness.timeScale.subscribeVisibleLogicalRangeChange).toHaveBeenCalledTimes(1);
    });
  });

  it('calls loadOlder() when panned near the left edge WHILE the DEX source is active', async () => {
    // Force DEX to win source selection, same setup as the #2579 regression
    // test in TradingChart.live-source-wiring.test.tsx.
    harness.sources.percolatorCandlesOverride = [
      { time: 1_720_000_000, open: 1, high: 1, low: 1, close: 1, volume: 1 },
    ];
    harness.sources.dexStatus = 'success';
    harness.sources.dexCandles = Array.from({ length: 1000 }, (_, i) => ({
      timestamp: 1_720_000_000_000 + i * 300_000,
      open: 121, high: 121.6, low: 120.4, close: 121.5, volume: 1,
    }));

    render(<TradingChart slabAddress="TestSlab1111111111111111111111111111111111" mintAddress="TestMint1111111111111111111111111111111111" />);
    await waitFor(() => expect(harness.timeScale.subscribeVisibleLogicalRangeChange).toHaveBeenCalledTimes(1));

    const handler = getRangeChangeHandler();
    handler({ from: 5, to: 50 }); // within the left-edge threshold

    expect(harness.loadOlder).toHaveBeenCalledTimes(1);
  });

  it('does NOT call loadOlder() when the visible range is far from the left edge', async () => {
    harness.sources.percolatorCandlesOverride = [
      { time: 1_720_000_000, open: 1, high: 1, low: 1, close: 1, volume: 1 },
    ];
    harness.sources.dexStatus = 'success';
    harness.sources.dexCandles = Array.from({ length: 1000 }, (_, i) => ({
      timestamp: 1_720_000_000_000 + i * 300_000,
      open: 121, high: 121.6, low: 120.4, close: 121.5, volume: 1,
    }));

    render(<TradingChart slabAddress="TestSlab1111111111111111111111111111111111" mintAddress="TestMint1111111111111111111111111111111111" />);
    await waitFor(() => expect(harness.timeScale.subscribeVisibleLogicalRangeChange).toHaveBeenCalledTimes(1));

    const handler = getRangeChangeHandler();
    handler({ from: 500, to: 550 }); // deep in the middle of the series

    expect(harness.loadOlder).not.toHaveBeenCalled();
  });

  it('does NOT call loadOlder() while a non-DEX source (e.g. Percolator) is active, even at the left edge', async () => {
    // Default harness config: Percolator wins (10 priced bars meets the
    // threshold), same as the CONTROL case in the live-source-wiring suite.
    render(<TradingChart slabAddress="TestSlab1111111111111111111111111111111111" mintAddress="TestMint1111111111111111111111111111111111" />);
    await waitFor(() => expect(harness.timeScale.subscribeVisibleLogicalRangeChange).toHaveBeenCalledTimes(1));

    const handler = getRangeChangeHandler();
    handler({ from: 0, to: 10 });

    expect(harness.loadOlder).not.toHaveBeenCalled();
  });

  it('ignores a null visible range without throwing', async () => {
    render(<TradingChart slabAddress="TestSlab1111111111111111111111111111111111" mintAddress="TestMint1111111111111111111111111111111111" />);
    await waitFor(() => expect(harness.timeScale.subscribeVisibleLogicalRangeChange).toHaveBeenCalledTimes(1));

    const handler = getRangeChangeHandler();
    expect(() => handler(null)).not.toThrow();
    expect(harness.loadOlder).not.toHaveBeenCalled();
  });

  it('unsubscribes from the range-change handler on unmount', async () => {
    const { unmount } = render(
      <TradingChart slabAddress="TestSlab1111111111111111111111111111111111" mintAddress="TestMint1111111111111111111111111111111111" />,
    );
    await waitFor(() => expect(harness.timeScale.subscribeVisibleLogicalRangeChange).toHaveBeenCalledTimes(1));
    unmount();
    expect(harness.timeScale.unsubscribeVisibleLogicalRangeChange).toHaveBeenCalledTimes(1);
  });
});
