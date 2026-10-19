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

import { ApiLogEntry, getApiLogs, subscribeApiLogs } from "./apiLogStore";

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

function buildCurl(entry: ApiLogEntry): string {
  const headers = (entry.requestHeaders ?? {}) as Record<string, unknown>;
  const headerFlags = Object.entries(headers)
    .map(([key, value]) => `-H '${key}: ${String(value)}'`)
    .join(" ");
  const bodyFlag =
    entry.body !== undefined ? `-d '${JSON.stringify(entry.body)}'` : "";
  return [`curl -X ${entry.method}`, headerFlags, bodyFlag, `'${entry.url}'`]
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

  useEffect(() => subscribeApiLogs(setLogs), []);

  const active = enabled ?? isDevEnvironment();

  const filteredLogs = useMemo(
    () =>
      logs.filter(
        (entry) => matchesFilter(entry, filter) && matchesQuery(entry, query),
      ),
    [logs, filter, query],
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

  function copyCurl(entry: ApiLogEntry) {
    const curl = buildCurl(entry);
    if (onCopyToClipboard) {
      onCopyToClipboard(curl);
    } else {
      Share.share({ message: curl });
    }
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
                  ["Request", `${selected.method} ${selected.url}`],
                  [
                    "Status",
                    `${selected.status}${selected.message ? ` — ${selected.message}` : ""}`,
                  ],
                  ["Time", `${selected.ms} ms`],
                  ["Params", pretty(selected.params)],
                  ["Body", pretty(selected.body)],
                  ["Request headers", pretty(selected.requestHeaders)],
                  ["Response", pretty(selected.response)],
                  ["Response headers", pretty(selected.responseHeaders)],
                ]}
                keyExtractor={([label]) => label}
                renderItem={({ item: [label, value] }) => (
                  <View style={styles.detailSection}>
                    <Text style={styles.detailLabel}>{label}</Text>
                    <Text style={styles.detailValue} selectable>
                      {value}
                    </Text>
                  </View>
                )}
                contentContainerStyle={styles.detailList}
              />
            </>
          ) : (
            <>
              <View style={styles.header}>
                <Text style={styles.title}>API Inspector</Text>
                <Pressable onPress={() => setVisible(false)}>
                  <Text style={styles.headerAction}>Close</Text>
                </Pressable>
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
                      <Text
                        style={[
                          styles.statusPill,
                          { color: statusColor(item) },
                        ]}
                      >
                        {item.pending ? "…" : item.status}
                      </Text>
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
  statusPill: { fontSize: 12, fontWeight: "700" },
  rowTime: { fontSize: 12, color: "#8a8a8e" },
  empty: { textAlign: "center", marginTop: 40, color: "#8a8a8e" },
  detailList: { paddingHorizontal: 16, paddingBottom: 40 },
  detailSection: { marginBottom: 16 },
  detailLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#8a8a8e",
    marginBottom: 4,
  },
  detailValue: { fontSize: 13, fontFamily: "Courier" },
});
