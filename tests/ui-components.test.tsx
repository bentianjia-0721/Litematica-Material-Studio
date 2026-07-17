import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StudioCatalogItem, StudioMaterial } from "../src/app/types";
import { ItemCatalog } from "../src/features/item-catalog/ItemCatalog";
import { MaterialTable } from "../src/features/material-table/MaterialTable";
import { MaterialToolbar } from "../src/features/material-table/MaterialToolbar";
import { ModResourceImporter } from "../src/features/mod-resources/ModResourceImporter";
import { UploadPanel } from "../src/features/upload/UploadPanel";
import { VersionSelector } from "../src/features/version-selector/VersionSelector";
import type { ModResourceImportResult } from "../src/lib/mod-resources";

afterEach(() => {
  cleanup();
});

function getFileInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) {
    throw new Error("未找到文件输入框");
  }
  return input;
}

function changeFile(input: HTMLInputElement, file: File): void {
  const files = {
    0: file,
    length: 1,
    item: (index: number) => (index === 0 ? file : null),
  } as unknown as FileList;
  fireEvent.change(input, { target: { files } });
}

const material: StudioMaterial = {
  id: "minecraft:oak_log",
  displayName: "橡木原木",
  displayNameEn: "Oak Log",
  required: 129,
  owned: 32,
  remaining: 97,
  maxStackSize: 64,
  status: "准确",
};

describe("UploadPanel", () => {
  it("接受大小写不敏感的 .litematic 扩展名", async () => {
    const user = userEvent.setup();
    const onFile = vi.fn<(file: File) => void>();
    const { container } = render(<UploadPanel onFile={onFile} />);
    const file = new File(["gzip-nbt"], "Ocean-Base.LITEMATIC", {
      type: "application/octet-stream",
    });

    await user.upload(getFileInput(container), file);

    expect(onFile).toHaveBeenCalledOnce();
    expect(onFile).toHaveBeenCalledWith(file);
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
  });

  it("通过 Enter 和空格键打开文件选择入口", () => {
    const { container } = render(<UploadPanel onFile={vi.fn()} />);
    const input = getFileInput(container);
    const inputClick = vi.spyOn(input, "click");
    const dropZone = screen.getByRole("button", { name: "拖拽或选择 Litematic 文件" });

    dropZone.focus();
    fireEvent.keyDown(dropZone, { key: "Enter" });
    expect(inputClick).toHaveBeenCalledOnce();

    inputClick.mockClear();
    fireEvent.keyDown(dropZone, { key: " " });
    expect(inputClick).toHaveBeenCalledOnce();
  });

  it("拒绝错误扩展名、空文件和超大文件，并在 live alert 中显示原因", () => {
    const onFile = vi.fn<(file: File) => void>();
    const { container } = render(<UploadPanel onFile={onFile} />);
    const input = getFileInput(container);

    changeFile(input, new File(["not nbt"], "build.txt"));
    expect(screen.getByRole("alert")).toHaveTextContent("请选择 .litematic 投影文件。");

    changeFile(input, new File([], "empty.litematic"));
    expect(screen.getByRole("alert")).toHaveTextContent("文件内容为空，无法解析。");

    const oversized = new File(["x"], "huge.litematic");
    Object.defineProperty(oversized, "size", { value: 128 * 1024 * 1024 + 1 });
    changeFile(input, oversized);
    expect(screen.getByRole("alert")).toHaveTextContent("文件超过 128 MiB 的浏览器安全上限。");
    expect(onFile).not.toHaveBeenCalled();
  });
});

describe("MaterialTable", () => {
  it("规范化数量输入，并将已有和剩余限制在总需求内", () => {
    const onQuantityChange = vi.fn();
    render(
      <MaterialTable
        materials={[material]}
        onQuantityChange={onQuantityChange}
        onMaxStackSizeChange={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "橡木原木 总共需要" }), {
      target: { value: "0012abc" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "橡木原木 已经拥有" }), {
      target: { value: "999" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "橡木原木 剩余需要" }), {
      target: { value: "999" },
    });

    expect(onQuantityChange).toHaveBeenNthCalledWith(1, "minecraft:oak_log", "required", 12);
    expect(onQuantityChange).toHaveBeenNthCalledWith(2, "minecraft:oak_log", "owned", 129);
    expect(onQuantityChange).toHaveBeenNthCalledWith(3, "minecraft:oak_log", "remaining", 129);
  });

  it("呈现堆叠 tooltip，并支持移动端点击展开和收起", async () => {
    const user = userEvent.setup();
    render(
      <MaterialTable
        materials={[material]}
        onQuantityChange={vi.fn()}
        onMaxStackSizeChange={vi.fn()}
      />,
    );
    const trigger = screen.getByRole("button", { name: "总共需要的堆叠计算结果" });
    const tooltip = screen.getByRole("tooltip", { name: "2 组 + 1 个" });

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(tooltip).toHaveTextContent("2 组 + 1 个");
    expect(tooltip).not.toHaveClass("stack-tooltip--open");

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-describedby", tooltip.id);
    expect(tooltip).toHaveClass("stack-tooltip--open");

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).not.toHaveAttribute("aria-describedby");
  });

  it("允许未知或 Mod 物品手动设置堆叠上限", () => {
    const onMaxStackSizeChange = vi.fn();
    render(
      <MaterialTable
        materials={[
          {
            ...material,
            id: "examplemod:glowing_bricks",
            status: "模组",
            maxStackSize: null,
          },
        ]}
        onQuantityChange={vi.fn()}
        onMaxStackSizeChange={onMaxStackSizeChange}
      />,
    );

    fireEvent.change(screen.getByRole("spinbutton", { name: "橡木原木 手动堆叠上限" }), {
      target: { value: "16" },
    });
    expect(screen.getByText("模组", { selector: ".status-chip--mod" })).toBeVisible();
    expect(onMaxStackSizeChange).toHaveBeenCalledWith("examplemod:glowing_bricks", 16);
  });
});

describe("MaterialToolbar", () => {
  it("传递搜索、状态筛选和排序事件", async () => {
    const user = userEvent.setup();
    const onQuery = vi.fn();
    const onFilter = vi.fn();
    const onSort = vi.fn();

    render(
      <MaterialToolbar
        query=""
        filter="all"
        sort="required-desc"
        count={3}
        canUndo={false}
        onQuery={onQuery}
        onFilter={onFilter}
        onSort={onSort}
        onResetOwned={vi.fn()}
        onCompleteAll={vi.fn()}
        onUndo={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索材料" }), {
      target: { value: "oak" },
    });
    await user.selectOptions(screen.getByRole("combobox", { name: "状态" }), "incomplete");
    await user.selectOptions(screen.getByRole("combobox", { name: "排序" }), "name");

    expect(onQuery).toHaveBeenCalledOnce();
    expect(onQuery).toHaveBeenCalledWith("oak");
    expect(onFilter).toHaveBeenCalledWith("incomplete");
    expect(onSort).toHaveBeenCalledWith("name");
    expect(screen.getByRole("button", { name: "撤销批量操作" })).toBeDisabled();
  });
});

describe("ModResourceImporter", () => {
  it("通过文件输入导入 JAR 并把当前投影的模组资源返回给应用", async () => {
    const user = userEvent.setup();
    const onImported = vi.fn<(result: ModResourceImportResult) => void>();
    const zip = new JSZip();
    zip.file(
      "assets/examplemod/lang/zh_cn.json",
      JSON.stringify({ "item.examplemod.test_item": "测试物品" }),
    );
    zip.file("assets/examplemod/textures/item/test_item.png", Uint8Array.of(1, 2, 3));
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    const file = new File([buffer], "examplemod.jar", {
      type: "application/java-archive",
    });
    const { container } = render(
      <ModResourceImporter targetIds={["examplemod:test_item"]} onImported={onImported} />,
    );

    await user.upload(getFileInput(container), file);

    await waitFor(() => expect(onImported).toHaveBeenCalledOnce());
    expect(onImported.mock.calls[0]?.[0].resources["examplemod:test_item"]).toMatchObject({
      displayName: "测试物品",
      sourceFile: "examplemod.jar",
    });
    expect(screen.getByRole("status")).toHaveTextContent("匹配 1 / 1 个模组材料");
  });
});

describe("ItemCatalog", () => {
  const catalogItems: StudioCatalogItem[] = [
    {
      id: "minecraft:stone",
      numericId: 1,
      displayName: "石头",
      displayNameEn: "Stone",
      maxStackSize: 64,
      iconPath: "/minecraft-icons/stone.png",
      iconSourceVersion: "1.21.1",
      isBlock: true,
    },
    {
      id: "minecraft:diamond_sword",
      numericId: 2,
      displayName: "钻石剑",
      displayNameEn: "Diamond Sword",
      maxStackSize: 1,
      iconPath: "/minecraft-icons/diamond-sword.png",
      iconSourceVersion: "1.21.1",
      isBlock: false,
    },
  ];

  it("展示当前版本完整物品数、图标并可筛选投影材料", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ItemCatalog
        version="1.21.1"
        items={catalogItems}
        materials={[{ ...material, id: "minecraft:stone", displayName: "石头" }]}
      />,
    );

    expect(screen.getByRole("heading", { name: "Minecraft Java 1.21.1 全部物品" })).toBeVisible();
    expect(screen.getByText("2 项", { selector: ".catalog-heading > strong" })).toBeVisible();
    expect(container.querySelector('img[src="/minecraft-icons/stone.png"]')).toBeTruthy();

    await user.selectOptions(screen.getByRole("combobox", { name: "目录范围" }), "project");
    expect(screen.getByText("石头", { selector: ".catalog-card__body strong" })).toBeVisible();
    expect(screen.queryByText("钻石剑", { selector: ".catalog-card__body strong" })).toBeNull();
    expect(screen.getByText("投影需要 ×129")).toBeVisible();
  });
});

describe("VersionSelector", () => {
  it("列出可用版本，并把手动选择和恢复自动识别传回应用", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <VersionSelector
        detectedVersion="1.21.1"
        selectedVersion={null}
        versions={["1.21.11", "1.21.1", "1.12.2"]}
        onChange={onChange}
      />,
    );
    const selector = screen.getByRole("combobox", {
      name: /物品数据版本.*DataVersion 精确匹配/u,
    });
    expect(screen.getByRole("option", { name: "Minecraft Java 1.12.2" })).toBeVisible();
    await user.selectOptions(selector, "1.12.2");
    expect(onChange).toHaveBeenLastCalledWith("1.12.2");
    await user.selectOptions(selector, "__auto__");
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});
