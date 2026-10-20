import React, { useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Modal,
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

function statusColor(entry: ApiLogEntry): string {
  if (entry.pending) return "#8a8a8e";
  return entry.ok ? "#1f9d55" : "#d64545";
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
  // Long-press-to-hide for an error row. Kept in local state (not the store), so it's a
  // session-only dismiss: it resets on the next app reload/remount, not a real delete.
  const [dismissedIds, setDismissedIds] = useState<ReadonlySet<number>>(
    () => new Set(),
  );

  useEffect(() => subscribeApiLogs(setLogs), []);

  const active = enabled ?? isDevEnvironment();

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

  const buttonPositionStyle = {
    top: position.startsWith("top") ? (insets?.top ?? 0) + 48 : undefined,
    bottom: position.startsWith("bottom")
      ? (insets?.bottom ?? 0) + 24
      : undefined,
    left: position.endsWith("left") ? (insets?.left ?? 0) + 16 : undefined,
    right: position.endsWith("right") ? (insets?.right ?? 0) + 16 : undefined,
  };

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
      <Pressable
        onPress={() => setVisible(true)}
        onLongPress={() => setHidden(true)}
        style={[styles.fab, buttonPositionStyle]}
      >
        <Text style={styles.fabIcon}>🐞</Text>
        {badgeCount > 0 && (
          <View style={[styles.badge, errorCount > 0 && styles.badgeError]}>
            <Text style={styles.badgeText}>
              {badgeCount > 99 ? "99+" : badgeCount}
            </Text>
          </View>
        )}
      </Pressable>

      <Modal
        visible={visible}
        animationType="slide"
        onRequestClose={() => setVisible(false)}
      >
        <View
          style={[styles.modalRoot, { paddingTop: (insets?.top ?? 0) + 12 }]}
        >
          {selected ? (
            <>
              <View style={styles.header}>
                <Pressable onPress={() => setSelectedId(null)}>
                  <Text style={styles.headerAction}>‹ Back</Text>
                </Pressable>
                <Pressable onPress={() => copyCurl(selected)}>
                  <Text style={styles.headerAction}>Copy as cURL</Text>
                </Pressable>
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
                  <View style={styles.summaryCard}>
                    <View style={styles.summaryTopRow}>
                      <Text style={styles.methodBadge}>{selected.method}</Text>
                      <Text
                        style={[
                          styles.statusBadge,
                          {
                            color: statusColor(selected),
                            borderColor: statusColor(selected),
                          },
                        ]}
                      >
                        {selected.pending ? "…" : selected.status}
                      </Text>
                      <Text style={styles.summaryTime}>
                        {selected.pending ? "" : `${selected.ms} ms`}
                      </Text>
                    </View>
                    <Text style={styles.summaryUrl} selectable>
                      {selected.url}
                    </Text>
                    {selected.message ? (
                      <Text style={styles.summaryMessage} selectable>
                        {selected.message}
                      </Text>
                    ) : null}
                  </View>
                }
                renderItem={({ item: [label, value] }) => (
                  <View style={styles.detailCard}>
                    <View style={styles.detailCardHeader}>
                      <Text style={styles.detailLabel}>{label}</Text>
                      {value !== "—" && (
                        <Pressable onPress={() => copyText(value)} hitSlop={8}>
                          <Text style={styles.detailCopyAction}>Copy</Text>
                        </Pressable>
                      )}
                    </View>
                    <View style={styles.codeBlock}>
                      <Text style={styles.detailValue} selectable>
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
                <Text style={styles.title}>API Inspector</Text>
                <View style={styles.headerActions}>
                  <Pressable onPress={() => clearApiLogs()}>
                    <Text style={styles.headerAction}>Clear</Text>
                  </Pressable>
                  <Pressable onPress={() => setVisible(false)}>
                    <Text style={styles.headerAction}>Close</Text>
                  </Pressable>
                </View>
              </View>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search by URL or status"
                placeholderTextColor="#8a8a8e"
                style={styles.search}
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
                      filter === option && styles.chipActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        filter === option && styles.chipTextActive,
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
                    style={styles.row}
                  >
                    <View style={styles.rowTop}>
                      <Text style={styles.rowMethod}>{item.method}</Text>
                      <Text style={styles.rowUrl} numberOfLines={1}>
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
                            { color: statusColor(item) },
                          ]}
                        >
                          {item.pending ? "…" : item.status}
                        </Text>
                      </View>
                      <Text style={styles.rowTime}>
                        {item.pending ? "" : `${item.ms} ms`}
                      </Text>
                    </View>
                  </Pressable>
                )}
                ListEmptyComponent={
                  <Text style={styles.empty}>No requests yet.</Text>
                }
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
