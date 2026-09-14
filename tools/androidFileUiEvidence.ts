import { DOMParser } from "@xmldom/xmldom";

export interface UiNode {
  attrs: Record<string, string>;
  bounds: { x1: number; y1: number; x2: number; y2: number } | null;
  parent: UiNode | null;
}

export type NodeMatcher = { attr: string; value: string; mode: "contains" | "equals" };

const invalidXmlCharacters = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/u;

export function parseAndroidUiXml(xml: string): UiNode[] | null {
  if (!xml.trim() || xml.length > 2 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml)) return null;
  // xmldom can discard junk before the root and tolerate bare ampersands.
  if (!/^(?:<\?xml\s[^?]*\?>\s*)?<hierarchy(?:\s|>)/.test(xml.trim())
    || /&(?!(?:amp|lt|gt|apos|quot|#\d+|#x[\da-fA-F]+);)/.test(xml)
    || invalidXmlCharacters.test(xml) || hasUnescapedAttributeDelimiter(xml)) return null;
  try {
    let invalid = false;
    const document = new DOMParser({ errorHandler: () => { invalid = true; } }).parseFromString(xml, "application/xml");
    const root = document.documentElement;
    if (invalid || !root || root.tagName !== "hierarchy" || document.doctype) return null;
    for (let child = document.firstChild; child; child = child.nextSibling) {
      if (child === root || (child.nodeType === 3 && !child.nodeValue?.trim())) continue;
      if (child.nodeType === 7 && child.nodeName === "xml" && child === document.firstChild) continue;
      return null;
    }
    const nodes: UiNode[] = [];
    type XmlElement = NonNullable<typeof root>;
    const visit = (element: XmlElement, parent: UiNode | null, depth: number): void => {
      for (let child = element.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 3 && !child.nodeValue?.trim()) continue;
        if (child.nodeType !== 1 || (child as XmlElement).tagName !== "node" || nodes.length >= 10000 || depth > 128) {
          throw new Error("Unsupported UI XML structure");
        }
        const nodeElement = child as XmlElement;
        const attrs: Record<string, string> = {};
        for (let i = 0; i < nodeElement.attributes.length; i += 1) {
          const attr = nodeElement.attributes.item(i)!;
          if (invalidXmlCharacters.test(attr.value)) throw new Error("Invalid XML attribute character");
          attrs[attr.name] = attr.value;
        }
        const node: UiNode = { attrs, bounds: parseBounds(attrs.bounds), parent };
        nodes.push(node);
        visit(nodeElement, node, depth + 1);
      }
    };
    visit(root, null, 1);
    return nodes.length ? nodes : null;
  } catch {
    return null;
  }
}

function hasUnescapedAttributeDelimiter(xml: string): boolean {
  let inTag = false;
  let quote = "";
  for (const character of xml) {
    if (quote) {
      if (character === "<") return true;
      if (character === quote) quote = "";
    } else if (character === "<") inTag = true;
    else if (character === ">") inTag = false;
    else if (inTag && (character === '"' || character === "'")) quote = character;
  }
  return quote !== "";
}

function parseBounds(value: string | undefined): UiNode["bounds"] {
  const match = value?.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/);
  if (!match) return null;
  const [x1, y1, x2, y2] = match.slice(1).map(Number);
  if (![x1, y1, x2, y2].every(Number.isSafeInteger) || x2 <= x1 || y2 <= y1) return null;
  return { x1, y1, x2, y2 };
}

function usable(node: UiNode): boolean {
  const bounds = node.bounds;
  if (!bounds) return false;
  for (let current: UiNode | null = node; current; current = current.parent) {
    const outer = current.bounds;
    if (current.attrs.enabled !== "true" || current.attrs["visible-to-user"] === "false" || !outer
      || bounds.x1 < outer.x1 || bounds.y1 < outer.y1 || bounds.x2 > outer.x2 || bounds.y2 > outer.y2) return false;
  }
  return true;
}

function blockingNodes(nodes: UiNode[]): boolean {
  return nodes.some(({ attrs }) => /(?:^android:id\/aerr_|^android:id\/alertTitle$)/.test(attrs["resource-id"] ?? "")
    || /isn['\u2019]t responding|not responding|has stopped/i.test(`${attrs.text ?? ""} ${attrs["content-desc"] ?? ""}`));
}

export function hasBlockingAndroidUi(xml: string): boolean {
  const nodes = parseAndroidUiXml(xml);
  return nodes !== null && blockingNodes(nodes);
}

function systemBar(node: UiNode): boolean {
  let bar = node;
  while (bar.parent?.attrs.package === "com.android.systemui") bar = bar.parent;
  return node.attrs.package === "com.android.systemui"
    && ["com.android.systemui:id/status_bar", "com.android.systemui:id/navigation_bar"].includes(bar.attrs["resource-id"]);
}

function trustedNodes(xml: string, packageName: string): UiNode[] | null {
  const nodes = parseAndroidUiXml(xml);
  if (!nodes || blockingNodes(nodes) || nodes.some((node) => node.attrs.package !== packageName && !systemBar(node))) return null;
  const roots = nodes.filter((node) => !node.parent && node.attrs.package === packageName);
  if (roots.length !== 1) return null;
  const expected = nodes.filter((node) => node.attrs.package === packageName);
  for (const node of expected) {
    let ancestor = node;
    while (ancestor.parent) {
      ancestor = ancestor.parent;
      if (ancestor.attrs.package !== packageName) return null;
    }
    if (ancestor !== roots[0]) return null;
  }
  return expected;
}

function hasId(nodes: UiNode[], ids: string[]): boolean {
  return nodes.some((node) => usable(node) && ids.includes(node.attrs["resource-id"]));
}

// Observed only in reports/android-native-verification/android-share-sheet-20260605-*.xml.
// The earlier synthetic resolver_drawer/resolver_list profile has no runtime basis.
export function isShareSheetXml(xml: string): boolean {
  const nodes = trustedNodes(xml, "com.android.intentresolver");
  if (!nodes) return false;
  const hasAncestor = (node: UiNode, ancestor: UiNode): boolean => {
    for (let parent = node.parent; parent; parent = parent.parent) if (parent === ancestor) return true;
    return false;
  };
  return nodes.some((frame) => usable(frame)
    && frame.attrs["resource-id"] === "com.android.intentresolver:id/sem_chooser_frame_root"
    && frame.attrs.class === "android.widget.FrameLayout"
    && nodes.some((panel) => usable(panel) && hasAncestor(panel, frame)
      && panel.attrs["resource-id"] === "android:id/contentPanel" && panel.attrs.class === "android.widget.ScrollView"
      && nodes.some((header) => usable(header) && hasAncestor(header, panel)
        && header.attrs["resource-id"] === "android:id/chooser_header" && header.attrs.class === "android.widget.RelativeLayout")
      && nodes.some((list) => usable(list) && hasAncestor(list, panel)
        && list.attrs["resource-id"] === "com.android.intentresolver:id/sem_chooser_recycler_ranked_app"
        && list.attrs.class === "android.widget.GridView")));
}

export function documentsPickerPackage(xml: string): string | null {
  for (const packageName of ["com.android.documentsui", "com.google.android.documentsui"]) {
    const nodes = trustedNodes(xml, packageName);
    if (nodes && hasId(nodes, [`${packageName}:id/toolbar`]) && hasId(nodes, [`${packageName}:id/dir_list`])) return packageName;
  }
  return null;
}

export function isDocumentsPickerXml(xml: string): boolean {
  return documentsPickerPackage(xml) !== null;
}

export function findNode(xml: string, matchers: NodeMatcher[], packageName: string): UiNode | null {
  const nodes = trustedNodes(xml, packageName);
  return nodes?.find((node) => usable(node) && matchers.some((matcher) => {
    const value = node.attrs[matcher.attr] ?? "";
    return matcher.mode === "equals" ? value === matcher.value : value.includes(matcher.value);
  })) ?? null;
}

export function findPickerFileNode(xml: string, filename: string): UiNode | null {
  const packageName = documentsPickerPackage(xml);
  if (!packageName) return null;
  const nodes = trustedNodes(xml, packageName)!;
  return nodes.find((node) => {
    if (!usable(node) || node.attrs.text !== filename || node.attrs["resource-id"] !== "android:id/title") return false;
    for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
      if (ancestor.attrs["resource-id"] === `${packageName}:id/dir_list`) return true;
    }
    return false;
  }) ?? null;
}

export interface TapAttempt { attempted: boolean; commandSucceeded: boolean }

export function attemptUiTap(node: UiNode | null, sendTap: (x: number, y: number) => boolean): TapAttempt {
  if (!node || !usable(node) || !node.bounds) return { attempted: false, commandSucceeded: false };
  const { x1, y1, x2, y2 } = node.bounds;
  try {
    return { attempted: true, commandSucceeded: sendTap(Math.floor((x1 + x2) / 2), Math.floor((y1 + y2) / 2)) === true };
  } catch {
    return { attempted: true, commandSucceeded: false };
  }
}

export function pickerAttemptEvidence(options: {
  filename: string;
  hostBytes: number;
  pushedZipPath: string;
  tap: TapAttempt;
}) {
  return {
    pushedZipPath: options.pushedZipPath,
    selectedZipFilename: "",
    selectedZipBytes: 0,
    documentsPickerEvidence: `Host fixture ${options.filename}: ${options.hostBytes} bytes; device push succeeded: ${options.pushedZipPath}. `
      + `File tap attempted: ${options.tap.attempted}; tap command succeeded: ${options.tap.commandSucceeded}. `
      + "Native received-file name and bytes are UNKNOWN; the native received-bytes event is not implemented. A tap does not establish receipt or import completion.",
  };
}

export function isFilesUiReady(xml: string, packageName: string): boolean {
  const nodes = trustedNodes(xml, packageName);
  return !!nodes && !nodes.some((node) => node.attrs.text === "No Project Open")
    && hasId(nodes, ["files-view", `${packageName}:id/files-view`])
    && hasId(nodes, ["files-action-import-zip", `${packageName}:id/files-action-import-zip`])
    && hasId(nodes, ["files-action-export-zip", `${packageName}:id/files-action-export-zip`]);
}

export function isExpectedProjectLoaded(xml: string, packageName: string, projectName: string): boolean {
  const nodes = trustedNodes(xml, packageName);
  if (!nodes || nodes.some((node) => ["No Project Open", "Project Catalog", "No project package selected."].includes(node.attrs.text))) return false;
  return breadcrumbMatches(nodes, packageName, projectName);
}

export function hasProjectBreadcrumb(xml: string, packageName: string, projectName: string): boolean {
  const nodes = trustedNodes(xml, packageName);
  return !!nodes && breadcrumbMatches(nodes, packageName, projectName);
}

export function isProjectCatalogUi(xml: string, packageName: string): boolean {
  const nodes = trustedNodes(xml, packageName);
  return !!nodes && (breadcrumbMatches(nodes, packageName, "Project Catalog") || nodes.some((node) => usable(node) && node.attrs.text === "No Project Open"));
}

function breadcrumbMatches(nodes: UiNode[], packageName: string, label: string): boolean {
  return nodes.some((node) => usable(node)
    && ["workspace-breadcrumb-current", `${packageName}:id/workspace-breadcrumb-current`].includes(node.attrs["resource-id"])
    && node.attrs.text === `CPLayout / ${label}`);
}

export function readConfirmedUiDump(remotePath: string, dump: () => string, read: () => string): string {
  const confirmation = dump();
  if (!confirmation.trim().endsWith(`UI hierchary dumped to: ${remotePath}`)) {
    throw new Error("UIAutomator did not confirm a fresh dump; stale XML will not be read.");
  }
  const xml = read();
  if (!xml.trim()) throw new Error("UIAutomator returned an empty dump.");
  return xml;
}
