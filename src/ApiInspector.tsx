import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  FlatList,
  Modal,
  PanResponder,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  ApiLogEntry,
  clearApiLogs,
  getApiLogs,
  subscribeApiLogs,
} from "./apiLogStore";

type Filter = "all" | "errors" | "pending";
type ThemeName = "light" | "dark";

interface Palette {
  background: string;
  surface: string;
  surfaceBorder: string;
  text: string;
  subtext: string;
  border: string;
  chipBg: string;
  chipActiveBg: string;
  chipText: string;
  chipActiveText: string;
  accent: string;
  codeBg: string;
  searchBg: string;
  errorColor: string;
  okColor: string;
  pendingColor: string;
}

const palettes: Record<ThemeName, Palette> = {
  light: {
    background: "#ffffff",
    surface: "#f7f7f9",
    surfaceBorder: "#ececef",
    text: "#1c1c1e",
    subtext: "#8a8a8e",
    border: "#eee",
    chipBg: "#f0f0f3",
    chipActiveBg: "#1c1c1e",
    chipText: "#1c1c1e",
    chipActiveText: "#ffffff",
    accent: "#3a79f2",
    codeBg: "#ffffff",
    searchBg: "#f0f0f3",
    errorColor: "#d64545",
    okColor: "#1f9d55",
    pendingColor: "#8a8a8e",
  },
  dark: {
    background: "#121214",
    surface: "#1c1c1f",
    surfaceBorder: "#2e2e31",
    text: "#f2f2f4",
    subtext: "#9a9a9e",
    border: "#2a2a2d",
    chipBg: "#232326",
    chipActiveBg: "#f2f2f4",
    chipText: "#f2f2f4",
    chipActiveText: "#121214",
    accent: "#5b96ff",
    codeBg: "#0c0c0e",
    searchBg: "#232326",
    errorColor: "#ff6b6b",
    okColor: "#3ddc84",
    pendingColor: "#9a9a9e",
  },
};

function createThemedStyles(colors: Palette) {
  return StyleSheet.create({
    modalRoot: { backgroundColor: colors.background },
    title: { color: colors.text },
    headerAction: { color: colors.accent },
    search: { backgroundColor: colors.searchBg, color: colors.text },
    chip: { backgroundColor: colors.chipBg },
    chipActive: { backgroundColor: colors.chipActiveBg },
    chipText: { color: colors.chipText },
    chipTextActive: { color: colors.chipActiveText },
    row: { borderBottomColor: colors.border },
    rowMethod: { color: colors.accent },
    rowUrl: { color: colors.text },
    rowTime: { color: colors.subtext },
    empty: { color: colors.subtext },
    summaryCard: {
      backgroundColor: colors.surface,
      borderColor: colors.surfaceBorder,
    },
    methodBadge: { backgroundColor: colors.accent },
    summaryTime: { color: colors.subtext },
    summaryUrl: { color: colors.text },
    summaryMessage: { color: colors.subtext },
    detailCard: {
      backgroundColor: colors.surface,
      borderColor: colors.surfaceBorder,
    },
    detailLabel: { color: colors.subtext },
    detailCopyAction: { color: colors.accent },
    codeBlock: {
      backgroundColor: colors.codeBg,
      borderColor: colors.surfaceBorder,
    },
    detailValue: { color: colors.text },
  });
}

export interface ApiInspectorInsets {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}

export interface ApiInspectorProps {
  /** Defaults to a dev-environment check; pass explicitly to force the overlay on/off. */
  enabled?: boolean;
  /** Pass your app's safe-area insets if you have them; the button otherwise uses a fixed offset. */
  insets?: ApiInspectorInsets;
  /** Starting corner for the button; it's freely draggable afterward and stays wherever it's dropped for the rest of the session. */
  position?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
  /** Wire this to a real clipboard module if the host app has one; otherwise "Copy as cURL" opens the native share sheet. */
  onCopyToClipboard?: (text: string) => void;
}

function isDevEnvironment(): boolean {
  const g = globalThis as { __DEV__?: boolean };
  return typeof g.__DEV__ === "boolean" ? g.__DEV__ : true;
}

function pretty(value: unknown): string {
  if (value === undefined) return "—";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function statusColor(entry: ApiLogEntry, colors: Palette): string {
  if (entry.pending) return colors.pendingColor;
  return entry.ok ? colors.okColor : colors.errorColor;
}

/** axios's `params` option never makes it into `entry.url` — it's sent separately at request time. */
function toQueryString(params: unknown): string {
  if (!params || typeof params !== "object") return "";
  const entries = Object.entries(params as Record<string, unknown>).filter(
    ([, value]) => value !== undefined,
  );
  if (entries.length === 0) return "";
  return entries
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
    )
    .join("&");
}

function buildCurl(entry: ApiLogEntry): string {
  const headers = (entry.requestHeaders ?? {}) as Record<string, unknown>;
  const headerFlags = Object.entries(headers)
    .map(([key, value]) => `-H '${key}: ${String(value)}'`)
    .join(" ");
  const bodyFlag =
    entry.body !== undefined ? `-d '${JSON.stringify(entry.body)}'` : "";
  const query = toQueryString(entry.params);
  const url = query
    ? `${entry.url}${entry.url.includes("?") ? "&" : "?"}${query}`
    : entry.url;
  return [`curl -X ${entry.method}`, headerFlags, bodyFlag, `'${url}'`]
    .filter(Boolean)
    .join(" ");
}

function matchesQuery(entry: ApiLogEntry, query: string): boolean {
  if (!query) return true;
  const haystack = `${entry.url} ${entry.status} ${entry.method}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function matchesFilter(entry: ApiLogEntry, filter: Filter): boolean {
  if (filter === "errors") return !entry.pending && !entry.ok;
  if (filter === "pending") return entry.pending;
  return true;
}

const FAB_SIZE = 48;
// Below this, a touch is treated as a tap (opens the inspector) rather than a drag.
const DRAG_THRESHOLD = 6;
const LONG_PRESS_MS = 500;

/** Starting corner for the draggable button, derived once from `position`/`insets`. */
function initialFabOrigin(
  position: NonNullable<ApiInspectorProps["position"]>,
  insets: ApiInspectorInsets | undefined,
): { top: number; left: number } {
  const { width, height } = Dimensions.get("window");
  const top = position.startsWith("top")
    ? (insets?.top ?? 0) + 48
    : height - ((insets?.bottom ?? 0) + 24) - FAB_SIZE;
  const left = position.endsWith("left")
    ? (insets?.left ?? 0) + 16
    : width - ((insets?.right ?? 0) + 16) - FAB_SIZE;
  return { top, left };
}

/** Keeps the button fully on-screen (and clear of insets) after a drag. */
function clampFabOrigin(
  origin: { top: number; left: number },
  insets: ApiInspectorInsets | undefined,
): { top: number; left: number } {
  const { width, height } = Dimensions.get("window");
  const minTop = insets?.top ?? 0;
  const maxTop = height - FAB_SIZE - (insets?.bottom ?? 0);
  const minLeft = insets?.left ?? 0;
  const maxLeft = width - FAB_SIZE - (insets?.right ?? 0);
  return {
    top: Math.min(Math.max(origin.top, minTop), Math.max(minTop, maxTop)),
    left: Math.min(Math.max(origin.left, minLeft), Math.max(minLeft, maxLeft)),
  };
}

export function ApiInspector({
  enabled,
  insets,
  position = "bottom-right",
  onCopyToClipboard,
}: ApiInspectorProps) {
  const [logs, setLogs] = useState<ApiLogEntry[]>(() => getApiLogs());
  const [hidden, setHidden] = useState(false);
  const [visible, setVisible] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [theme, setTheme] = useState<ThemeName>("light");
  const colors = palettes[theme];
  const themed = useMemo(() => createThemedStyles(colors), [theme]);
  const toggleTheme = () =>
    setTheme((current) => (current === "light" ? "dark" : "light"));
  // Long-press-to-hide for an error row. Kept in local state (not the store), so it's a
  // session-only dismiss: it resets on the next app reload/remount, not a real delete.
  const [dismissedIds, setDismissedIds] = useState<ReadonlySet<number>>(
    () => new Set(),
  );

  useEffect(() => subscribeApiLogs(setLogs), []);

  const active = enabled ?? isDevEnvironment();

  // `fabOrigin` is the committed (non-dragging) top/left; `pan` is the live offset applied
  // via `transform` while a drag is in progress. They're kept separate so a drag never fights
  // layout: on release the offset is folded into `fabOrigin` and `pan` resets to zero.
  const [fabOrigin, setFabOrigin] = useState(() =>
    initialFabOrigin(position, insets),
  );
  const fabOriginRef = useRef(fabOrigin);
  fabOriginRef.current = fabOrigin;
  const pan = useRef(new Animated.ValueXY()).current;
  const dragStateRef = useRef({ moved: false, longPressFired: false });
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearLongPressTimer() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        dragStateRef.current = { moved: false, longPressFired: false };
        longPressTimer.current = setTimeout(() => {
          dragStateRef.current.longPressFired = true;
          setHidden(true);
        }, LONG_PRESS_MS);
      },
      onPanResponderMove: (evt, gestureState) => {
        if (
          !dragStateRef.current.moved &&
          (Math.abs(gestureState.dx) > DRAG_THRESHOLD ||
            Math.abs(gestureState.dy) > DRAG_THRESHOLD)
        ) {
          dragStateRef.current.moved = true;
          clearLongPressTimer();
        }
        if (dragStateRef.current.moved) {
          pan.setValue({ x: gestureState.dx, y: gestureState.dy });
        }
      },
      onPanResponderRelease: (evt, gestureState) => {
        clearLongPressTimer();
        if (dragStateRef.current.longPressFired) return;
        if (!dragStateRef.current.moved) {
          setVisible(true);
          return;
        }
        const next = clampFabOrigin(
          {
            top: fabOriginRef.current.top + gestureState.dy,
            left: fabOriginRef.current.left + gestureState.dx,
          },
          insets,
        );
        pan.setValue({ x: 0, y: 0 });
        setFabOrigin(next);
      },
      onPanResponderTerminate: () => {
        clearLongPressTimer();
        pan.setValue({ x: 0, y: 0 });
      },
    }),
  ).current;

  function dismissLog(id: number) {
    setDismissedIds((prev) => new Set(prev).add(id));
  }

  const filteredLogs = useMemo(
    () =>
      logs.filter(
        (entry) =>
          !dismissedIds.has(entry.id) &&
          matchesFilter(entry, filter) &&
          matchesQuery(entry, query),
      ),
    [logs, filter, query, dismissedIds],
  );

  const errorCount = useMemo(
    () => logs.filter((entry) => !entry.pending && !entry.ok).length,
    [logs],
  );
  const badgeCount = errorCount > 0 ? errorCount : logs.length;

  const selected =
    selectedId !== null
      ? logs.find((entry) => entry.id === selectedId)
      : undefined;

  if (!active || hidden) return null;

  function copyText(text: string) {
    if (onCopyToClipboard) {
      onCopyToClipboard(text);
    } else {
      Share.share({ message: text });
    }
  }

  function copyCurl(entry: ApiLogEntry) {
    copyText(buildCurl(entry));
  }

  return (
    <>
      <Animated.View
        {...panResponder.panHandlers}
        style={[
          styles.fab,
          {
            top: fabOrigin.top,
            left: fabOrigin.left,
            transform: pan.getTranslateTransform(),
          },
        ]}
      >
        <Text style={styles.fabIcon}>🐞</Text>
        {badgeCount > 0 && (
          <View style={[styles.badge, errorCount > 0 && styles.badgeError]}>
            <Text style={styles.badgeText}>
              {badgeCount > 99 ? "99+" : badgeCount}
            </Text>
          </View>
        )}
      </Animated.View>

      <Modal
        visible={visible}
        animationType="slide"
        onRequestClose={() => setVisible(false)}
      >
        <View
          style={[
            styles.modalRoot,
            themed.modalRoot,
            { paddingTop: (insets?.top ?? 0) + 12 },
          ]}
        >
          {selected ? (
            <>
              <View style={styles.header}>
                <Pressable onPress={() => setSelectedId(null)}>
                  <Text style={[styles.headerAction, themed.headerAction]}>
                    ‹ Back
                  </Text>
                </Pressable>
                <View style={styles.headerActions}>
                  <Pressable onPress={toggleTheme} hitSlop={8}>
                    <Text style={styles.themeToggle}>
                      {theme === "light" ? "🌙" : "☀️"}
                    </Text>
                  </Pressable>
                  <Pressable onPress={() => copyCurl(selected)}>
                    <Text style={[styles.headerAction, themed.headerAction]}>
                      Copy as cURL
                    </Text>
                  </Pressable>
                </View>
              </View>
              <FlatList
                data={[
                  ["Params", pretty(selected.params)],
                  ["Body", pretty(selected.body)],
                  ["Request headers", pretty(selected.requestHeaders)],
                  ["Response", pretty(selected.response)],
                  ["Response headers", pretty(selected.responseHeaders)],
                ]}
                keyExtractor={([label]) => label}
                ListHeaderComponent={
                  <View style={[styles.summaryCard, themed.summaryCard]}>
                    <View style={styles.summaryTopRow}>
                      <Text style={[styles.methodBadge, themed.methodBadge]}>
                        {selected.method}
                      </Text>
                      <Text
                        style={[
                          styles.statusBadge,
                          {
                            color: statusColor(selected, colors),
                            borderColor: statusColor(selected, colors),
                          },
                        ]}
                      >
                        {selected.pending ? "…" : selected.status}
                      </Text>
                      <Text style={[styles.summaryTime, themed.summaryTime]}>
                        {selected.pending ? "" : `${selected.ms} ms`}
                      </Text>
                    </View>
                    <Text
                      style={[styles.summaryUrl, themed.summaryUrl]}
                      selectable
                    >
                      {selected.url}
                    </Text>
                    {selected.message ? (
                      <Text
                        style={[styles.summaryMessage, themed.summaryMessage]}
                        selectable
                      >
                        {selected.message}
                      </Text>
                    ) : null}
                  </View>
                }
                renderItem={({ item: [label, value] }) => (
                  <View style={[styles.detailCard, themed.detailCard]}>
                    <View style={styles.detailCardHeader}>
                      <Text style={[styles.detailLabel, themed.detailLabel]}>
                        {label}
                      </Text>
                      {value !== "—" && (
                        <Pressable onPress={() => copyText(value)} hitSlop={8}>
                          <Text
                            style={[
                              styles.detailCopyAction,
                              themed.detailCopyAction,
                            ]}
                          >
                            Copy
                          </Text>
                        </Pressable>
                      )}
                    </View>
                    <View style={[styles.codeBlock, themed.codeBlock]}>
                      <Text style={[styles.detailValue, themed.detailValue]} selectable>
                        {value}
                      </Text>
                    </View>
                  </View>
                )}
                contentContainerStyle={styles.detailList}
              />
            </>
          ) : (
            <>
              <View style={styles.header}>
                <Text style={[styles.title, themed.title]}>API Inspector</Text>
                <View style={styles.headerActions}>
                  <Pressable onPress={toggleTheme} hitSlop={8}>
                    <Text style={styles.themeToggle}>
                      {theme === "light" ? "🌙" : "☀️"}
                    </Text>
                  </Pressable>
                  <Pressable onPress={() => clearApiLogs()}>
                    <Text style={[styles.headerAction, themed.headerAction]}>
                      Clear
                    </Text>
                  </Pressable>
                  <Pressable onPress={() => setVisible(false)}>
                    <Text style={[styles.headerAction, themed.headerAction]}>
                      Close
                    </Text>
                  </Pressable>
                </View>
              </View>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search by URL or status"
                placeholderTextColor={colors.subtext}
                style={[styles.search, themed.search]}
                autoCorrect={false}
                autoCapitalize="none"
              />
              <View style={styles.chips}>
                {(["all", "errors", "pending"] as Filter[]).map((option) => (
                  <Pressable
                    key={option}
                    onPress={() => setFilter(option)}
                    style={[
                      styles.chip,
                      themed.chip,
                      filter === option && styles.chipActive,
                      filter === option && themed.chipActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        themed.chipText,
                        filter === option && styles.chipTextActive,
                        filter === option && themed.chipTextActive,
                      ]}
                    >
                      {option === "all"
                        ? "All"
                        : option === "errors"
                          ? "Errors"
                          : "Pending"}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <FlatList
                data={filteredLogs}
                keyExtractor={(entry) => String(entry.id)}
                renderItem={({ item }) => (
                  <Pressable
                    onPress={() => setSelectedId(item.id)}
                    style={[styles.row, themed.row]}
                  >
                    <View style={styles.rowTop}>
                      <Text style={[styles.rowMethod, themed.rowMethod]}>
                        {item.method}
                      </Text>
                      <Text
                        style={[styles.rowUrl, themed.rowUrl]}
                        numberOfLines={1}
                      >
                        {item.url}
                      </Text>
                    </View>
                    <View style={styles.rowBottom}>
                      <View style={styles.rowStatusGroup}>
                        {!item.pending && !item.ok && (
                          <Pressable
                            onLongPress={() => dismissLog(item.id)}
                            hitSlop={8}
                          >
                            <Text style={styles.errorIcon}>⚠️</Text>
                          </Pressable>
                        )}
                        <Text
                          style={[
                            styles.statusPill,
                            { color: statusColor(item, colors) },
                          ]}
                        >
                          {item.pending ? "…" : item.status}
                        </Text>
                      </View>
                      <Text style={[styles.rowTime, themed.rowTime]}>
                        {item.pending ? "" : `${item.ms} ms`}
                      </Text>
                    </View>
                  </Pressable>
                )}
                ListEmptyComponent={
                  <Text style={[styles.empty, themed.empty]}>
                    No requests yet.
                  </Text>
                }
                contentContainerStyle={[
                  styles.listContent,
                  { paddingBottom: (insets?.bottom ?? 0) + 24 },
                ]}
              />
            </>
          )}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#1c1c1e",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
    elevation: 10,
  },
  fabIcon: { fontSize: 22 },
  badge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: "#3a79f2",
    alignItems: "center",
    justifyContent: "center",
  },
  badgeError: { backgroundColor: "#d64545" },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "600" },
  modalRoot: { flex: 1, backgroundColor: "#fff" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  title: { fontSize: 17, fontWeight: "600" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 16 },
  headerAction: { fontSize: 15, color: "#3a79f2" },
  themeToggle: { fontSize: 16 },
  search: {
    marginHorizontal: 16,
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#f0f0f3",
    fontSize: 14,
  },
  chips: {
    flexDirection: "row",
    paddingHorizontal: 16,
    marginBottom: 8,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: "#f0f0f3",
  },
  chipActive: { backgroundColor: "#1c1c1e" },
  chipText: { fontSize: 13, color: "#1c1c1e" },
  chipTextActive: { color: "#fff" },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowMethod: { fontSize: 12, fontWeight: "700", color: "#3a79f2", width: 52 },
  rowUrl: { fontSize: 13, flex: 1 },
  rowBottom: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4,
  },
  rowStatusGroup: { flexDirection: "row", alignItems: "center", gap: 6 },
  errorIcon: { fontSize: 12 },
  statusPill: { fontSize: 12, fontWeight: "700" },
  rowTime: { fontSize: 12, color: "#8a8a8e" },
  empty: { textAlign: "center", marginTop: 40, color: "#8a8a8e" },
  listContent: { paddingBottom: 24 },
  detailList: { paddingHorizontal: 16, paddingBottom: 40 },
  summaryCard: {
    marginBottom: 16,
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#f7f7f9",
    borderWidth: 1,
    borderColor: "#ececef",
  },
  summaryTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  methodBadge: {
    fontSize: 12,
    fontWeight: "700",
    color: "#fff",
    backgroundColor: "#3a79f2",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: "hidden",
  },
  statusBadge: {
    fontSize: 12,
    fontWeight: "700",
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: "hidden",
  },
  summaryTime: { fontSize: 12, color: "#8a8a8e", marginLeft: "auto" },
  summaryUrl: { fontSize: 14, fontWeight: "600", marginBottom: 2 },
  summaryMessage: { fontSize: 12, color: "#8a8a8e" },
  detailCard: {
    marginBottom: 12,
    padding: 12,
    borderRadius: 10,
    backgroundColor: "#f7f7f9",
    borderWidth: 1,
    borderColor: "#ececef",
  },
  detailCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  detailLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#8a8a8e",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  detailCopyAction: { fontSize: 12, fontWeight: "700", color: "#3a79f2" },
  codeBlock: {
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ececef",
    padding: 10,
  },
  detailValue: {
    fontSize: 12.5,
    fontFamily: "Courier",
    lineHeight: 18,
    color: "#1c1c1e",
  },
});
