/**
 * SalesAnalyticsPanel
 *
 * Drop-in analytics section for AdminDashboardScreen.
 * Replaces the plain renderAnalytics() block with rich,
 * interactive visuals — all built from the existing
 * AdminSnapshot data shape, zero new dependencies.
 *
 * Components exported:
 *   - SalesAnalyticsPanel   (main panel, replaces renderAnalytics content)
 *   - MiniSparkline         (7-day trend bar spark)
 *   - DonutRing             (SVG donut for payment / category split)
 *   - HorizontalBarChart    (top-sellers ranked bars)
 *   - ProfitGauge           (margin % arc gauge)
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  ViewStyle,
  View,
} from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { GlassPanel } from '../../../components/glass/GlassPanel';
import { useThemeStore } from '../../../store/themeStore';
import type { AdminSnapshot } from '../../../services/adminService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PeriodKey = 'day' | 'week' | 'month';

interface PeriodMetrics {
  grossSalesCents: number;
  netProfitCents: number;
  totalOrders: number;
  averageOrderValueCents: number;
}

interface TopSeller {
  productId: string | null;
  productName: string;
  quantitySold: number;
  revenueCents: number;
  grossMarginCents: number;
  marginPercent: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const phpFormatter = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const formatCurrency = (cents: number) => phpFormatter.format(cents / 100);
const formatCurrencyFull = (cents: number) =>
  new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
  }).format(cents / 100);

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** Derive last-N-days buckets from raw transactions */
function buildDailyBuckets(
  transactions: AdminSnapshot['transactions'],
  days: number
): { label: string; salesCents: number; profitCents: number }[] {
  const buckets: { label: string; salesCents: number; profitCents: number }[] = [];
  const now = new Date();

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    const label = d.toLocaleDateString('en-PH', { weekday: 'short' });

    const dayEnd = new Date(d);
    dayEnd.setHours(23, 59, 59, 999);

    const dayTxns = transactions.filter((t) => {
      const ts = new Date(t.createdAt).getTime();
      return ts >= d.getTime() && ts <= dayEnd.getTime() && t.status === 'completed';
    });

    buckets.push({
      label,
      salesCents: dayTxns.reduce((sum, t) => sum + t.totalCents, 0),
      profitCents: dayTxns.reduce((sum, t) => sum + t.netProfitCents, 0),
    });
  }

  return buckets;
}

/** Payment method breakdown from transactions */
function buildPaymentBreakdown(transactions: AdminSnapshot['transactions']) {
  const map: Record<string, number> = {};
  for (const t of transactions) {
    if (t.status !== 'completed') continue;
    const method = (t as any).paymentMethod ?? 'Cash';
    map[method] = (map[method] ?? 0) + t.totalCents;
  }
  return Object.entries(map)
    .map(([label, cents]) => ({ label, cents }))
    .sort((a, b) => b.cents - a.cents);
}

// ---------------------------------------------------------------------------
// AnimatedPressable helper
// ---------------------------------------------------------------------------

const ScalePressable = ({
  children,
  onPress,
  style,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) => {
  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn = () =>
    Animated.spring(scale, { toValue: 0.96, useNativeDriver: true, speed: 30 }).start();
  const handlePressOut = () =>
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 20 }).start();

  return (
    <Pressable onPress={onPress} onPressIn={handlePressIn} onPressOut={handlePressOut} style={style}>
      <Animated.View style={{ transform: [{ scale }] }}>{children}</Animated.View>
    </Pressable>
  );
};

// ---------------------------------------------------------------------------
// Period Toggle
// ---------------------------------------------------------------------------

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'day', label: 'Today' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
];

const PeriodToggle = ({
  active,
  onChange,
}: {
  active: PeriodKey;
  onChange: (key: PeriodKey) => void;
}) => {
  const { palette } = useThemeStore();

  return (
    <View style={[periodStyles.wrap, { backgroundColor: `${palette.surface}CC`, borderColor: `${palette.text}18` }]}>
      {PERIODS.map(({ key, label }) => {
        const isActive = key === active;
        return (
          <Pressable
            key={key}
            onPress={() => onChange(key)}
            style={[
              periodStyles.pill,
              isActive && { backgroundColor: palette.primary },
            ]}
          >
            <Text
              style={[
                periodStyles.pillText,
                { color: isActive ? '#fff' : palette.mutedText },
              ]}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
};

const periodStyles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    borderRadius: 999,
    borderWidth: 1,
    padding: 3,
    alignSelf: 'flex-start',
    marginBottom: 16,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '700',
  },
});

// ---------------------------------------------------------------------------
// Metric Hero Cards
// ---------------------------------------------------------------------------

const MetricHeroCard = ({
  label,
  value,
  sub,
  accent,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  accent: string;
  icon: string;
}) => {
  const { palette } = useThemeStore();
  const scale = useRef(new Animated.Value(1)).current;

  return (
    <ScalePressable
      style={[
        heroStyles.card,
        {
          backgroundColor: `${palette.surface}D8`,
          borderColor: `${accent}30`,
        },
      ]}
    >
      <View style={[heroStyles.iconBadge, { backgroundColor: `${accent}20` }]}>
        <Text style={heroStyles.iconText}>{icon}</Text>
      </View>
      <Text style={[heroStyles.label, { color: palette.mutedText }]}>{label}</Text>
      <Text style={[heroStyles.value, { color: palette.text }]}>{value}</Text>
      {sub ? <Text style={[heroStyles.sub, { color: accent }]}>{sub}</Text> : null}
      <View style={[heroStyles.accentLine, { backgroundColor: accent }]} />
    </ScalePressable>
  );
};

const heroStyles = StyleSheet.create({
  card: {
    width: '48%',
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
    overflow: 'hidden',
  },
  iconBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  iconText: {
    fontSize: 18,
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  value: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  sub: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 3,
  },
  accentLine: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
  },
});

// ---------------------------------------------------------------------------
// MiniSparkline — bar chart showing last 7 days
// ---------------------------------------------------------------------------

export const MiniSparkline = ({
  buckets,
  width = 300,
  height = 80,
  showProfit = false,
}: {
  buckets: { label: string; salesCents: number; profitCents: number }[];
  width?: number;
  height?: number;
  showProfit?: boolean;
}) => {
  const { palette } = useThemeStore();
  const [tooltip, setTooltip] = useState<{ idx: number; x: number; y: number } | null>(null);

  const maxVal = Math.max(...buckets.map((b) => (showProfit ? b.profitCents : b.salesCents)), 1);
  const barWidth = (width - 20) / buckets.length;
  const barGap = barWidth * 0.25;
  const bw = barWidth - barGap;

  const bars = buckets.map((b, i) => {
    const val = showProfit ? b.profitCents : b.salesCents;
    const barH = clamp((val / maxVal) * (height - 28), 4, height - 28);
    const x = 10 + i * barWidth + barGap / 2;
    const y = height - 20 - barH;
    return { ...b, x, y, barH, val };
  });

  return (
    <View>
      <Svg width={width} height={height}>
        {/* Horizontal guide lines */}
        {[0.25, 0.5, 0.75, 1].map((pct) => (
          <Line
            key={pct}
            x1={10}
            x2={width - 10}
            y1={height - 20 - (height - 28) * pct}
            y2={height - 20 - (height - 28) * pct}
            stroke={`${palette.text}12`}
            strokeWidth={1}
          />
        ))}

        {bars.map((bar, i) => {
          const isHovered = tooltip?.idx === i;
          const color = showProfit ? palette.success : palette.primary;
          return (
            <G key={i}>
              {/* Background touch area */}
              <Rect
                x={bar.x - 2}
                y={0}
                width={bw + 4}
                height={height}
                fill="transparent"
                onPress={() =>
                  setTooltip(
                    tooltip?.idx === i ? null : { idx: i, x: bar.x, y: bar.y }
                  )
                }
              />
              {/* Bar */}
              <Rect
                x={bar.x}
                y={bar.y}
                width={bw}
                height={bar.barH}
                rx={4}
                fill={isHovered ? color : `${color}AA`}
              />
              {/* Label */}
              <SvgText
                x={bar.x + bw / 2}
                y={height - 4}
                textAnchor="middle"
                fontSize={9}
                fill={palette.mutedText}
              >
                {bar.label}
              </SvgText>
            </G>
          );
        })}

        {/* Tooltip */}
        {tooltip !== null && bars[tooltip.idx] ? (
          <G>
            <Rect
              x={clamp(bars[tooltip.idx].x - 20, 0, width - 80)}
              y={Math.max(2, bars[tooltip.idx].y - 26)}
              width={80}
              height={22}
              rx={6}
              fill={palette.primary}
            />
            <SvgText
              x={clamp(bars[tooltip.idx].x - 20, 0, width - 80) + 40}
              y={Math.max(2, bars[tooltip.idx].y - 26) + 14}
              textAnchor="middle"
              fontSize={9}
              fontWeight="bold"
              fill="#fff"
            >
              {formatCurrency(bars[tooltip.idx].val)}
            </SvgText>
          </G>
        ) : null}
      </Svg>
    </View>
  );
};

// ---------------------------------------------------------------------------
// DonutRing — payment method split
// ---------------------------------------------------------------------------

const DONUT_COLORS = ['#12b886', '#4dabf7', '#f59f00', '#f783ac', '#a9e34b', '#cc5de8'];

export const DonutRing = ({
  segments,
  size = 120,
  strokeWidth = 18,
}: {
  segments: { label: string; cents: number }[];
  size?: number;
  strokeWidth?: number;
}) => {
  const { palette } = useThemeStore();
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const r = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const total = segments.reduce((s, seg) => s + seg.cents, 0);

  if (total === 0) {
    return (
      <View style={{ alignItems: 'center', justifyContent: 'center', height: size }}>
        <Text style={{ color: palette.mutedText, fontSize: 12 }}>No data</Text>
      </View>
    );
  }

  let offset = 0;

  const arcs = segments.map((seg, i) => {
    const pct = seg.cents / total;
    const dash = pct * circumference;
    const gap = circumference - dash;
    const rotation = offset * 360 - 90; // start at top
    offset += pct;
    return { ...seg, dash, gap, rotation, color: DONUT_COLORS[i % DONUT_COLORS.length] };
  });

  const active = activeIdx !== null ? arcs[activeIdx] : null;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Svg width={size} height={size}>
        {/* Background track */}
        <Circle
          cx={cx}
          cy={cy}
          r={r}
          stroke={`${palette.text}10`}
          strokeWidth={strokeWidth}
          fill="none"
        />
        {arcs.map((arc, i) => (
          <Circle
            key={i}
            cx={cx}
            cy={cy}
            r={r}
            stroke={arc.color}
            strokeWidth={activeIdx === i ? strokeWidth + 4 : strokeWidth}
            strokeDasharray={`${arc.dash} ${arc.gap}`}
            strokeLinecap="round"
            fill="none"
            rotation={arc.rotation}
            origin={`${cx}, ${cy}`}
            onPress={() => setActiveIdx(activeIdx === i ? null : i)}
            opacity={activeIdx === null || activeIdx === i ? 1 : 0.4}
          />
        ))}
        {/* Center label */}
        <SvgText x={cx} y={cy - 6} textAnchor="middle" fontSize={10} fill={palette.mutedText}>
          {active ? active.label : 'Total'}
        </SvgText>
        <SvgText x={cx} y={cy + 10} textAnchor="middle" fontSize={12} fontWeight="bold" fill={palette.text}>
          {active ? `${Math.round((active.cents / total) * 100)}%` : formatCurrency(total)}
        </SvgText>
      </Svg>

      {/* Legend */}
      <View style={{ flex: 1, gap: 6 }}>
        {arcs.map((arc, i) => (
          <Pressable
            key={i}
            onPress={() => setActiveIdx(activeIdx === i ? null : i)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
          >
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: arc.color,
                opacity: activeIdx === null || activeIdx === i ? 1 : 0.4,
              }}
            />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: palette.text }}>{arc.label}</Text>
              <Text style={{ fontSize: 10, color: palette.mutedText }}>{formatCurrency(arc.cents)}</Text>
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  );
};

// ---------------------------------------------------------------------------
// HorizontalBarChart — top sellers
// ---------------------------------------------------------------------------

export const HorizontalBarChart = ({
  sellers,
  width = 300,
}: {
  sellers: TopSeller[];
  width?: number;
}) => {
  const { palette } = useThemeStore();
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const maxRev = Math.max(...sellers.map((s) => s.revenueCents), 1);
  const ROW_H = 42;
  const LEFT_PAD = 90;
  const BAR_AREA = width - LEFT_PAD - 10;

  return (
    <View style={{ gap: 6 }}>
      {sellers.slice(0, 6).map((seller, i) => {
        const pct = seller.revenueCents / maxRev;
        const barW = pct * BAR_AREA;
        const isActive = activeIdx === i;
        const accentColor = DONUT_COLORS[i % DONUT_COLORS.length];

        return (
          <Pressable key={seller.productId ?? seller.productName} onPress={() => setActiveIdx(isActive ? null : i)}>
            <View style={[
              barChartStyles.row,
              isActive && { backgroundColor: `${accentColor}10`, borderRadius: 10 },
            ]}>
              {/* Product name */}
              <View style={{ width: LEFT_PAD }}>
                <Text
                  numberOfLines={2}
                  style={[barChartStyles.rowLabel, { color: isActive ? palette.text : palette.mutedText }]}
                >
                  {seller.productName}
                </Text>
              </View>

              {/* Bar track */}
              <View style={[barChartStyles.track, { width: BAR_AREA, backgroundColor: `${palette.text}0A` }]}>
                <View
                  style={[
                    barChartStyles.bar,
                    { width: barW, backgroundColor: accentColor, opacity: isActive ? 1 : 0.7 },
                  ]}
                />
                <Text style={[barChartStyles.barValue, { color: palette.text }]}>
                  {formatCurrency(seller.revenueCents)}
                </Text>
              </View>
            </View>

            {/* Expanded detail */}
            {isActive ? (
              <View style={[barChartStyles.detail, { borderColor: `${accentColor}30`, backgroundColor: `${accentColor}08` }]}>
                <View style={barChartStyles.detailGrid}>
                  <View style={barChartStyles.detailCell}>
                    <Text style={[barChartStyles.detailLabel, { color: palette.mutedText }]}>Qty Sold</Text>
                    <Text style={[barChartStyles.detailValue, { color: palette.text }]}>{seller.quantitySold}</Text>
                  </View>
                  <View style={barChartStyles.detailCell}>
                    <Text style={[barChartStyles.detailLabel, { color: palette.mutedText }]}>Gross Margin</Text>
                    <Text style={[barChartStyles.detailValue, { color: palette.success ?? accentColor }]}>
                      {formatCurrency(seller.grossMarginCents)}
                    </Text>
                  </View>
                  <View style={barChartStyles.detailCell}>
                    <Text style={[barChartStyles.detailLabel, { color: palette.mutedText }]}>Margin %</Text>
                    <Text style={[barChartStyles.detailValue, { color: palette.text }]}>{seller.marginPercent}%</Text>
                  </View>
                </View>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
};

const barChartStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 4,
  },
  rowLabel: {
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 14,
  },
  track: {
    height: 26,
    borderRadius: 6,
    overflow: 'hidden',
    justifyContent: 'center',
    position: 'relative',
  },
  bar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 6,
  },
  barValue: {
    fontSize: 10,
    fontWeight: '700',
    paddingLeft: 6,
    zIndex: 1,
  },
  detail: {
    marginHorizontal: 4,
    marginBottom: 4,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
  },
  detailGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  detailCell: {
    flex: 1,
  },
  detailLabel: {
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '800',
  },
});

// ---------------------------------------------------------------------------
// ProfitGauge — arc gauge showing net margin %
// ---------------------------------------------------------------------------

export const ProfitGauge = ({
  marginPct,
  size = 110,
}: {
  marginPct: number;
  size?: number;
}) => {
  const { palette } = useThemeStore();
  const clamped = clamp(marginPct, 0, 100);
  const r = size / 2 - 12;
  const cx = size / 2;
  const cy = size / 2 + 10;

  // Arc spans 210 degrees (from 195° to 345°, i.e. bottom-left to bottom-right)
  const START_DEG = 195;
  const SWEEP = 150;
  const needleDeg = START_DEG + (clamped / 100) * SWEEP;

  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const arcPoint = (deg: number, radius: number) => ({
    x: cx + radius * Math.cos(toRad(deg)),
    y: cy + radius * Math.sin(toRad(deg)),
  });

  const startP = arcPoint(START_DEG, r);
  const endP = arcPoint(START_DEG + SWEEP, r);
  const fillEndP = arcPoint(needleDeg, r);
  const needleEnd = arcPoint(needleDeg, r - 6);
  const needleBase = arcPoint(needleDeg + 90, 5);
  const needleBase2 = arcPoint(needleDeg - 90, 5);

  const color =
    clamped >= 60 ? palette.success ?? '#12b886'
    : clamped >= 30 ? '#f59f00'
    : palette.danger ?? '#fa5252';

  return (
    <View style={{ alignItems: 'center' }}>
      <Svg width={size} height={size * 0.8}>
        {/* Background arc */}
        <Path
          d={`M ${startP.x} ${startP.y} A ${r} ${r} 0 0 1 ${endP.x} ${endP.y}`}
          stroke={`${palette.text}15`}
          strokeWidth={10}
          fill="none"
          strokeLinecap="round"
        />
        {/* Filled arc */}
        {clamped > 0 ? (
          <Path
            d={`M ${startP.x} ${startP.y} A ${r} ${r} 0 ${clamped > 50 ? 1 : 0} 1 ${fillEndP.x} ${fillEndP.y}`}
            stroke={color}
            strokeWidth={10}
            fill="none"
            strokeLinecap="round"
          />
        ) : null}
        {/* Needle */}
        <Path
          d={`M ${needleBase.x} ${needleBase.y} L ${needleEnd.x} ${needleEnd.y} L ${needleBase2.x} ${needleBase2.y} Z`}
          fill={color}
          opacity={0.9}
        />
        {/* Center dot */}
        <Circle cx={cx} cy={cy} r={4} fill={palette.text} />
        {/* Labels */}
        <SvgText x={cx} y={cy - 12} textAnchor="middle" fontSize={14} fontWeight="bold" fill={color}>
          {Math.round(clamped)}%
        </SvgText>
        <SvgText x={cx} y={cy + 2} textAnchor="middle" fontSize={8} fill={palette.mutedText}>
          NET MARGIN
        </SvgText>
      </Svg>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: size, marginTop: -10 }}>
        <Text style={{ fontSize: 8, color: palette.mutedText }}>0%</Text>
        <Text style={{ fontSize: 8, color: palette.mutedText }}>100%</Text>
      </View>
    </View>
  );
};

// ---------------------------------------------------------------------------
// SalesAnalyticsPanel — main exported component
// ---------------------------------------------------------------------------

export const SalesAnalyticsPanel = ({
  snapshot,
  containerWidth,
}: {
  snapshot: AdminSnapshot | null;
  containerWidth: number;
}) => {
  const { palette } = useThemeStore();
  const [period, setPeriod] = useState<PeriodKey>('day');
  const [sparkMode, setSparkMode] = useState<'sales' | 'profit'>('sales');

  const overview = snapshot?.overview ?? null;
  const transactions = snapshot?.transactions ?? [];

  const metrics: PeriodMetrics = useMemo(() => {
    if (!overview) {
      return { grossSalesCents: 0, netProfitCents: 0, totalOrders: 0, averageOrderValueCents: 0 };
    }
    return overview[period];
  }, [overview, period]);

  const marginPct = useMemo(() => {
    if (!metrics.grossSalesCents) return 0;
    return Math.round((metrics.netProfitCents / metrics.grossSalesCents) * 100);
  }, [metrics]);

  const dailyBuckets = useMemo(() => buildDailyBuckets(transactions, 7), [transactions]);

  const paymentBreakdown = useMemo(() => buildPaymentBreakdown(transactions), [transactions]);

  const topSellers: TopSeller[] = useMemo(
    () => (overview?.topSellers ?? []).slice(0, 6),
    [overview]
  );

  const chartWidth = containerWidth > 0 ? containerWidth - 48 : 300; // 48 = panel padding + gap

  if (!snapshot) {
    return (
      <GlassPanel>
        <Text style={[{ color: palette.mutedText, fontSize: 13 }]}>Loading analytics...</Text>
      </GlassPanel>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      {/* ── Period toggle + Hero KPI cards ── */}
      <GlassPanel>
        <Text style={[panelStyles.sectionTitle, { color: palette.text }]}>Sales Overview</Text>
        <PeriodToggle active={period} onChange={setPeriod} />

        <View style={panelStyles.heroGrid}>
          <MetricHeroCard
            label="Gross Sales"
            value={formatCurrency(metrics.grossSalesCents)}
            accent={palette.primary}
            icon="💰"
          />
          <MetricHeroCard
            label="Net Profit"
            value={formatCurrency(metrics.netProfitCents)}
            sub={`${marginPct}% margin`}
            accent={palette.success ?? '#12b886'}
            icon="📈"
          />
          <MetricHeroCard
            label="Orders"
            value={`${metrics.totalOrders}`}
            accent="#4dabf7"
            icon="🧾"
          />
          <MetricHeroCard
            label="Avg Order"
            value={formatCurrency(metrics.averageOrderValueCents)}
            accent="#f59f00"
            icon="🎯"
          />
        </View>
      </GlassPanel>

      {/* ── 7-day Sparkline ── */}
      <GlassPanel>
        <View style={panelStyles.rowBetween}>
          <Text style={[panelStyles.sectionTitle, { color: palette.text }]}>7-Day Trend</Text>
          <View style={panelStyles.toggleRow}>
            <Pressable
              onPress={() => setSparkMode('sales')}
              style={[
                panelStyles.modeBtn,
                sparkMode === 'sales' && { backgroundColor: palette.primary },
              ]}
            >
              <Text style={[panelStyles.modeBtnText, { color: sparkMode === 'sales' ? '#fff' : palette.mutedText }]}>
                Sales
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setSparkMode('profit')}
              style={[
                panelStyles.modeBtn,
                sparkMode === 'profit' && { backgroundColor: palette.success ?? '#12b886' },
              ]}
            >
              <Text style={[panelStyles.modeBtnText, { color: sparkMode === 'profit' ? '#fff' : palette.mutedText }]}>
                Profit
              </Text>
            </Pressable>
          </View>
        </View>
        <Text style={[panelStyles.hint, { color: palette.mutedText }]}>Tap a bar for exact value</Text>
        <MiniSparkline
          buckets={dailyBuckets}
          width={chartWidth}
          height={100}
          showProfit={sparkMode === 'profit'}
        />
      </GlassPanel>

      {/* ── Net Margin Gauge ── */}
      <GlassPanel>
        <View style={panelStyles.rowBetween}>
          <View style={{ flex: 1 }}>
            <Text style={[panelStyles.sectionTitle, { color: palette.text }]}>Profit Health</Text>
            <Text style={[panelStyles.hint, { color: palette.mutedText }]}>
              Based on {period === 'day' ? 'today' : period === 'week' ? 'this week' : 'this month'}
            </Text>
            <View style={{ marginTop: 10, gap: 6 }}>
              <GaugeRow
                label="Gross Sales"
                value={formatCurrencyFull(metrics.grossSalesCents)}
                palette={palette}
              />
              <GaugeRow
                label="Net Profit"
                value={formatCurrencyFull(metrics.netProfitCents)}
                palette={palette}
                accent={palette.success}
              />
              <GaugeRow
                label="Cost of Goods"
                value={formatCurrencyFull(metrics.grossSalesCents - metrics.netProfitCents)}
                palette={palette}
                accent={palette.danger}
              />
            </View>
          </View>
          <ProfitGauge marginPct={marginPct} size={120} />
        </View>
      </GlassPanel>

      {/* ── Top Sellers Bar Chart ── */}
      {topSellers.length > 0 ? (
        <GlassPanel>
          <Text style={[panelStyles.sectionTitle, { color: palette.text }]}>Top Sellers</Text>
          <Text style={[panelStyles.hint, { color: palette.mutedText }]}>Tap a row to see margin details</Text>
          <HorizontalBarChart sellers={topSellers} width={chartWidth} />
        </GlassPanel>
      ) : null}

      {/* ── Payment Method Donut ── */}
      {paymentBreakdown.length > 0 ? (
        <GlassPanel>
          <Text style={[panelStyles.sectionTitle, { color: palette.text }]}>Payment Mix</Text>
          <Text style={[panelStyles.hint, { color: palette.mutedText }]}>Tap a segment to highlight</Text>
          <DonutRing segments={paymentBreakdown} size={130} />
        </GlassPanel>
      ) : null}

      {/* ── Quick stats row ── */}
      <GlassPanel>
        <Text style={[panelStyles.sectionTitle, { color: palette.text }]}>Store Summary</Text>
        <View style={panelStyles.quickStatsGrid}>
          <QuickStat
            label="Products"
            value={`${snapshot.products.filter((p) => p.active).length}`}
            icon="📦"
            palette={palette}
          />
          <QuickStat
            label="Categories"
            value={`${snapshot.categories.filter((c) => c.active).length}`}
            icon="🗂️"
            palette={palette}
          />
          <QuickStat
            label="Staff"
            value={`${snapshot.staffMembers.filter((s) => s.active).length}`}
            icon="👤"
            palette={palette}
          />
          <QuickStat
            label="Ingredients"
            value={`${snapshot.inventoryItems.length}`}
            icon="🧂"
            palette={palette}
          />
          <QuickStat
            label="Transactions"
            value={`${transactions.filter((t) => t.status === 'completed').length}`}
            icon="✅"
            palette={palette}
          />
          <QuickStat
            label="Low Stock"
            value={`${snapshot.products.filter((p) => p.inventory_tracking && p.stock_count <= 5 && p.active).length}`}
            icon="⚠️"
            palette={palette}
            danger={snapshot.products.some((p) => p.inventory_tracking && p.stock_count <= 5 && p.active)}
          />
        </View>
      </GlassPanel>
    </View>
  );
};

// ---------------------------------------------------------------------------
// Small sub-components
// ---------------------------------------------------------------------------

const GaugeRow = ({
  label,
  value,
  palette,
  accent,
}: {
  label: string;
  value: string;
  palette: any;
  accent?: string;
}) => (
  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
    <Text style={{ fontSize: 11, color: palette.mutedText, fontWeight: '600' }}>{label}</Text>
    <Text style={{ fontSize: 12, fontWeight: '700', color: accent ?? palette.text }}>{value}</Text>
  </View>
);

const QuickStat = ({
  label,
  value,
  icon,
  palette,
  danger,
}: {
  label: string;
  value: string;
  icon: string;
  palette: any;
  danger?: boolean;
}) => (
  <View
    style={[
      quickStatStyles.cell,
      {
        backgroundColor: danger ? `${palette.danger}15` : `${palette.surface}CC`,
        borderColor: danger ? `${palette.danger}40` : `${palette.text}12`,
      },
    ]}
  >
    <Text style={quickStatStyles.icon}>{icon}</Text>
    <Text style={[quickStatStyles.value, { color: danger ? palette.danger : palette.text }]}>{value}</Text>
    <Text style={[quickStatStyles.label, { color: palette.mutedText }]}>{label}</Text>
  </View>
);

const quickStatStyles = StyleSheet.create({
  cell: {
    width: '30%',
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    alignItems: 'center',
    marginBottom: 8,
  },
  icon: {
    fontSize: 20,
    marginBottom: 4,
  },
  value: {
    fontSize: 18,
    fontWeight: '800',
  },
  label: {
    fontSize: 9,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginTop: 2,
    textAlign: 'center',
  },
});

const panelStyles = StyleSheet.create({
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 4,
  },
  hint: {
    fontSize: 11,
    marginBottom: 12,
  },
  heroGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'space-between',
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  toggleRow: {
    flexDirection: 'row',
    gap: 4,
  },
  modeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  modeBtnText: {
    fontSize: 11,
    fontWeight: '700',
  },
  quickStatsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
    marginTop: 8,
  },
});