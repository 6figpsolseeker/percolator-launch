/**
 * Chart zoom UI: the +/−/reset buttons and the "drag to zoom" toggle
 * (ChartZoomControls, wired via useChartZoomControls) plus the explicit
 * axis-drag-scale chart option. Mirrors the mocking pattern in
 * TradingChart.scroll-back-paging.test.tsx (a fresh, self-contained
 * harness here rather than importing that file's internal one, so this
 * stays a focused single-concern test file).
 *
 * Pure zoom math (centering, min-bars/extent clamping, pixel->logical
 * projection) is covered separately and exhaustively in
 * __tests__/lib/chart-zoom.test.ts — these tests only assert the wiring:
 * a button click reads the chart's current visible range and calls
 * setVisibleLogicalRange with the right numbers, the toggle flips UI
 * state, and axisPressedMouseMove is explicitly enabled on chart init.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  // The "current visible range" the mocked chart reports back to the
  // zoom-in/zoom-out handlers — set per-test via harness.visibleRange.
  const timeScale = {
    fitContent: vi.fn(),
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

  return {
    chart,
    timeScale,
    series,
    percolatorCandles,
    emptyCandles,
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

vi.mock('@/hooks/usePercolatorCandles', () => ({
  usePercolatorCandles: () => ({ candles: harness.percolatorCandles, status: 'success' }),
}));

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

describe('TradingChart zoom controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.visibleRange = null;
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ prices: [] }) })));
  });

  async function renderChart() {
    const utils = render(
      <TradingChart slabAddress="TestSlab1111111111111111111111111111111111" mintAddress="TestMint1111111111111111111111111111111111" />,
    );
    await waitFor(() => expect(harness.chart.timeScale).toHaveBeenCalled());
    return utils;
  }

  it('enables explicit axis-drag-scale (time + price) alongside mouse-wheel zoom on chart init', async () => {
    const { createChart } = await import('lightweight-charts');
    await renderChart();
    expect(createChart).toHaveBeenCalledTimes(1);
    const options = (createChart as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as {
      handleScale: { axisPressedMouseMove: unknown; mouseWheel: unknown; pinch: unknown };
    };
    expect(options.handleScale.axisPressedMouseMove).toEqual({ time: true, price: true });
    expect(options.handleScale.mouseWheel).toBe(true);
    expect(options.handleScale.pinch).toBe(true);
  });

  it('renders zoom in / zoom out / reset / drag-to-zoom controls', async () => {
    await renderChart();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset zoom' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Drag to zoom' })).toBeInTheDocument();
  });

  it('Zoom in narrows the current visible logical range by 0.7x around its center', async () => {
    harness.visibleRange = { from: 0, to: 100 };
    const user = userEvent.setup();
    await renderChart();

    await user.click(screen.getByRole('button', { name: 'Zoom in' }));

    expect(harness.timeScale.setVisibleLogicalRange).toHaveBeenCalledTimes(1);
    const range = harness.timeScale.setVisibleLogicalRange.mock.calls[0][0] as { from: number; to: number };
    expect(range.from).toBeCloseTo(15, 5);
    expect(range.to).toBeCloseTo(85, 5);
  });

  it('Zoom out widens the current visible logical range by 1/0.7x around its center', async () => {
    harness.visibleRange = { from: 40, to: 60 }; // width 20, center 50
    const user = userEvent.setup();
    await renderChart();

    await user.click(screen.getByRole('button', { name: 'Zoom out' }));

    expect(harness.timeScale.setVisibleLogicalRange).toHaveBeenCalledTimes(1);
    const range = harness.timeScale.setVisibleLogicalRange.mock.calls[0][0] as { from: number; to: number };
    const width = range.to - range.from;
    expect(width).toBeCloseTo(20 / 0.7, 5);
    expect((range.from + range.to) / 2).toBeCloseTo(50, 5);
  });

  it('Zoom in/out no-op when the chart reports no visible range yet (no data)', async () => {
    harness.visibleRange = null;
    const user = userEvent.setup();
    await renderChart();

    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));

    expect(harness.timeScale.setVisibleLogicalRange).not.toHaveBeenCalled();
  });

  it('Reset zoom calls timeScale().fitContent()', async () => {
    const user = userEvent.setup();
    await renderChart();
    const callsBefore = harness.timeScale.fitContent.mock.calls.length;

    await user.click(screen.getByRole('button', { name: 'Reset zoom' }));

    expect(harness.timeScale.fitContent.mock.calls.length).toBe(callsBefore + 1);
  });

  it('the drag-to-zoom toggle flips aria-pressed on click (pan <-> box-zoom)', async () => {
    const user = userEvent.setup();
    await renderChart();

    const toggle = screen.getByRole('button', { name: 'Drag to zoom' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });
});
