import type { Folder } from "./types";

/**
 * 把平铺的文件夹列表组织成树：roots = 顶层文件夹（保持 listFolders 的排序），
 * children = 每个父文件夹 id → 它的直接子文件夹数组（同样保持原顺序）。
 * parent_id 指向一个不存在文件夹的，按顶层处理（健壮性，避免挂死）。
 */
export function folderTree(
  folders: Folder[]
): { roots: Folder[]; children: Map<string, Folder[]> } {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const children = new Map<string, Folder[]>();
  const roots: Folder[] = [];
  for (const f of folders) {
    if (f.parent_id && byId.has(f.parent_id)) {
      const arr = children.get(f.parent_id);
      if (arr) arr.push(f);
      else children.set(f.parent_id, [f]);
    } else {
      roots.push(f);
    }
  }
  return { roots, children };
}

/** 把文件夹树压平成「带缩进深度」的列表（先序遍历），供侧栏 / 移动列表 / 「移动笔记」菜单按缩进渲染。 */
export function flattenFolderTree(
  folders: Folder[]
): { folder: Folder; depth: number }[] {
  const { roots, children } = folderTree(folders);
  const out: { folder: Folder; depth: number }[] = [];
  const walk = (list: Folder[], depth: number) => {
    for (const f of list) {
      out.push({ folder: f, depth });
      walk(children.get(f.id) ?? [], depth + 1);
    }
  };
  walk(roots, 0);
  return out;
}

/** 某个文件夹自身 + 它全部后代文件夹的 id 集合（用于「选中父文件夹 → 展示其子树下所有笔记」）。 */
export function descendantFolderIds(
  folders: Folder[],
  id: string
): Set<string> {
  const { children } = folderTree(folders);
  const out = new Set<string>([id]);
  const walk = (pid: string) => {
    for (const c of children.get(pid) ?? []) {
      out.add(c.id);
      walk(c.id);
    }
  };
  walk(id);
  return out;
}

/** 每个文件夹（含子文件夹）笔记总数：直接笔记 + 后代文件夹的笔记，供侧栏 / 列表计数。 */
export function folderNoteTotals(
  folders: Folder[],
  direct: Map<string, number>
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const f of folders) {
    let t = 0;
    for (const id of descendantFolderIds(folders, f.id)) t += direct.get(id) ?? 0;
    totals.set(f.id, t);
  }
  return totals;
}
