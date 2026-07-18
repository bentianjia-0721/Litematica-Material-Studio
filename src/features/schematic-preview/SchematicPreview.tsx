import { type MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AmbientLight,
  Box3,
  Box3Helper,
  BoxGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  DynamicDrawUsage,
  GridHelper,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  type Material,
  MeshLambertMaterial,
  NearestFilter,
  PerspectiveCamera,
  Scene,
  Sphere,
  SRGBColorSpace,
  type Texture,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { LitematicPreview } from "../../lib/litematic";
import { clampCameraDistance } from "./camera-controls";
import {
  bakeMinecraftModelGeometry,
  type MinecraftAtlasKind,
  type MinecraftTextureLookup,
} from "./minecraft-model-geometry";
import { loadMojangResources, type MojangResolvedResources } from "./mojang-resources";
import {
  blockStateColor,
  countVisibleBlocks,
  resolveLayerRange,
  type PreviewLayerMode,
  type PreviewLayerRange,
} from "./preview-model";

interface SchematicPreviewProps {
  preview: LitematicPreview;
}

interface PreviewMeshGroup {
  readonly mesh: InstancedMesh;
}

interface PreviewRuntime {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly viewport: HTMLDivElement;
  readonly meshGroups: PreviewMeshGroup[];
  readonly groupsByState: Map<number, PreviewMeshGroup[]>;
  readonly centre: Vector3;
  readonly distance: number;
  readonly render: () => void;
}

interface OwnedGraphics {
  readonly geometries: Set<BufferGeometry>;
  readonly materials: Set<Material>;
  readonly textures: Set<Texture>;
}

interface ModelStatus {
  readonly phase: "idle" | "loading" | "ready" | "fallback";
  readonly message: string;
}

const integerFormatter = new Intl.NumberFormat("zh-CN");
const fallbackVoxelColour = 0x8aa99a;

function cameraDistance(runtime: PreviewRuntime): number {
  return runtime.camera.position.distanceTo(runtime.controls.target);
}

function configurePerspective(runtime: PreviewRuntime): void {
  const { camera, controls, distance } = runtime;
  camera.up.set(0, 1, 0);
  camera.position.set(distance * 0.78, distance * 0.62, distance * 0.78);
  controls.target.set(0, 0, 0);
  controls.update();
}

function disposeMaterials(material: Material | Material[]): void {
  if (Array.isArray(material)) material.forEach((item) => item.dispose());
  else material.dispose();
}

function capacitiesByState(preview: LitematicPreview): Map<number, number> {
  const capacities = new Map<number, number>();
  for (let index = 0; index < preview.sampledBlockCount; index += 1) {
    const stateIndex = preview.stateIndices[index] ?? 0;
    capacities.set(stateIndex, (capacities.get(stateIndex) ?? 0) + 1);
  }
  return capacities;
}

function registerMesh(
  runtime: PreviewRuntime,
  owned: OwnedGraphics,
  stateIndex: number,
  geometry: BufferGeometry,
  material: Material,
  capacity: number,
): void {
  const mesh = new InstancedMesh(geometry, material, Math.max(1, capacity));
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.count = 0;
  mesh.frustumCulled = false;
  runtime.scene.add(mesh);
  const group = { mesh };
  runtime.meshGroups.push(group);
  const groups = runtime.groupsByState.get(stateIndex) ?? [];
  groups.push(group);
  runtime.groupsByState.set(stateIndex, groups);
  owned.geometries.add(geometry);
  owned.materials.add(material);
}

function updateMeshGroups(
  runtime: PreviewRuntime,
  preview: LitematicPreview,
  layerRange: PreviewLayerRange,
): void {
  const visibleCounts = new Map<PreviewMeshGroup, number>();
  runtime.meshGroups.forEach((group) => visibleCounts.set(group, 0));
  const matrix = new Matrix4();

  for (let sourceIndex = 0; sourceIndex < preview.sampledBlockCount; sourceIndex += 1) {
    const offset = sourceIndex * 3;
    const x = preview.positions[offset];
    const y = preview.positions[offset + 1];
    const z = preview.positions[offset + 2];
    if (x === undefined || y === undefined || z === undefined) continue;
    if (y < layerRange.min || y > layerRange.max) continue;

    const stateIndex = preview.stateIndices[sourceIndex] ?? 0;
    const groups = runtime.groupsByState.get(stateIndex);
    if (!groups) continue;
    matrix.makeTranslation(x - runtime.centre.x, y - runtime.centre.y, z - runtime.centre.z);
    for (const group of groups) {
      const visibleCount = visibleCounts.get(group) ?? 0;
      group.mesh.setMatrixAt(visibleCount, matrix);
      visibleCounts.set(group, visibleCount + 1);
    }
  }

  for (const group of runtime.meshGroups) {
    group.mesh.count = visibleCounts.get(group) ?? 0;
    group.mesh.instanceMatrix.needsUpdate = true;
  }
  runtime.render();
}

function addFallbackMeshes(
  runtime: PreviewRuntime,
  owned: OwnedGraphics,
  preview: LitematicPreview,
  capacities: ReadonlyMap<number, number>,
): number {
  const geometry = new BoxGeometry(0.92, 0.92, 0.92);
  owned.geometries.add(geometry);
  const materialByColour = new Map<number, MeshLambertMaterial>();
  let added = 0;

  preview.states.forEach((state, stateIndex) => {
    if (runtime.groupsByState.has(stateIndex)) return;
    const capacity = capacities.get(stateIndex) ?? 0;
    if (capacity === 0) return;
    const colour = blockStateColor(state) ?? fallbackVoxelColour;
    let material = materialByColour.get(colour);
    if (!material) {
      material = new MeshLambertMaterial({ color: colour, toneMapped: false });
      materialByColour.set(colour, material);
      owned.materials.add(material);
    }
    registerMesh(runtime, owned, stateIndex, geometry, material, capacity);
    added += 1;
  });
  return added;
}

function atlasLookup(resources: MojangResolvedResources): MinecraftTextureLookup {
  return (textureName) => {
    const region = resources.textureLookup.get(textureName);
    if (!region || region.atlasIndex > 1) return undefined;
    return {
      u: region.u0,
      v: region.v0,
      su: region.u1 - region.u0,
      sv: region.v1 - region.v0,
      imageType: (region.atlasIndex === 0 ? "latest" : "legacy") satisfies MinecraftAtlasKind,
    };
  };
}

function createAtlasMaterials(
  resources: MojangResolvedResources,
  owned: OwnedGraphics,
): Partial<Record<MinecraftAtlasKind, MeshLambertMaterial>> {
  const output: Partial<Record<MinecraftAtlasKind, MeshLambertMaterial>> = {};
  resources.atlases.slice(0, 2).forEach((atlas, index) => {
    const texture = new CanvasTexture(atlas.canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.magFilter = NearestFilter;
    texture.minFilter = NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    const material = new MeshLambertMaterial({
      map: texture,
      alphaTest: 0.02,
      transparent: true,
      depthWrite: true,
      side: DoubleSide,
      vertexColors: true,
      toneMapped: false,
    });
    const kind: MinecraftAtlasKind = index === 0 ? "latest" : "legacy";
    output[kind] = material;
    owned.textures.add(texture);
    owned.materials.add(material);
  });
  return output;
}

function addMinecraftMeshes(
  runtime: PreviewRuntime,
  owned: OwnedGraphics,
  preview: LitematicPreview,
  resources: MojangResolvedResources,
): { modelledStates: number; fallbackStates: number } {
  const capacities = capacitiesByState(preview);
  const materials = createAtlasMaterials(resources, owned);
  const getTexture = atlasLookup(resources);
  let modelledStates = 0;

  preview.states.forEach((state, stateIndex) => {
    const capacity = capacities.get(stateIndex) ?? 0;
    if (capacity === 0) return;
    const result = bakeMinecraftModelGeometry(
      state,
      resources.resolvedModels.get(state.key),
      getTexture,
    );
    if (!result.geometries || result.missing) return;

    let addedForState = 0;
    for (const kind of ["latest", "legacy"] as const) {
      const geometry = result.geometries[kind];
      const material = materials[kind];
      if (!geometry || !material) continue;
      registerMesh(runtime, owned, stateIndex, geometry, material, capacity);
      addedForState += 1;
    }
    if (addedForState > 0) modelledStates += 1;
  });

  const fallbackStates = addFallbackMeshes(runtime, owned, preview, capacities);
  return { modelledStates, fallbackStates };
}

function fallbackMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : "未知错误";
  return `内置 Minecraft 1.21.11 资源加载失败，已明确降级为彩色占位：${detail}`;
}

export function SchematicPreview({ preview }: SchematicPreviewProps) {
  const bounds = preview.bounds;
  const minimumY = bounds?.min.y ?? 0;
  const maximumY = bounds?.max.y ?? 0;
  const [mode, setMode] = useState<PreviewLayerMode>("all");
  const [singleLayer, setSingleLayer] = useState(maximumY);
  const [rangeStart, setRangeStart] = useState(minimumY);
  const [rangeEnd, setRangeEnd] = useState(maximumY);
  const [useXkrd, setUseXkrd] = useState(false);
  const [webglError, setWebglError] = useState<string | null>(null);
  const [modelStatus, setModelStatus] = useState<ModelStatus>({ phase: "idle", message: "" });
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<PreviewRuntime | null>(null);

  const layerRange = useMemo(
    () =>
      bounds
        ? resolveLayerRange({ mode, singleLayer, rangeStart, rangeEnd }, bounds)
        : { min: 0, max: 0 },
    [bounds, mode, rangeEnd, rangeStart, singleLayer],
  );
  const layerRangeRef = useRef(layerRange);

  useEffect(() => {
    layerRangeRef.current = layerRange;
  }, [layerRange]);

  const visibleCount = useMemo(
    () => countVisibleBlocks(preview.positions, layerRange),
    [layerRange, preview.positions],
  );

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !bounds) return;

    const abortController = new AbortController();
    const owned: OwnedGraphics = {
      geometries: new Set(),
      materials: new Set(),
      textures: new Set(),
    };
    let renderer: WebGLRenderer | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let controls: OrbitControls | null = null;
    let boundsHelper: Box3Helper | null = null;
    let grid: GridHelper | null = null;
    let errorTimer: number | null = null;
    let renderScene: (() => void) | null = null;

    try {
      renderer = new WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
      });
      renderer.outputColorSpace = SRGBColorSpace;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setClearColor(0x07100d, 1);
      renderer.domElement.setAttribute("aria-hidden", "true");
      viewport.append(renderer.domElement);

      const scene = new Scene();
      scene.background = new Color(0x07100d);
      scene.add(new AmbientLight(0xffffff, 1.1));
      scene.add(new HemisphereLight(0xd9ffec, 0x254d3a, 1.35));
      const directional = new DirectionalLight(0xffffff, 1.8);
      directional.position.set(8, 12, 7);
      scene.add(directional);

      const centre = new Vector3(
        (bounds.min.x + bounds.max.x) / 2,
        (bounds.min.y + bounds.max.y) / 2,
        (bounds.min.z + bounds.max.z) / 2,
      );
      const localBounds = new Box3(
        new Vector3(
          bounds.min.x - centre.x - 0.5,
          bounds.min.y - centre.y - 0.5,
          bounds.min.z - centre.z - 0.5,
        ),
        new Vector3(
          bounds.max.x - centre.x + 0.5,
          bounds.max.y - centre.y + 0.5,
          bounds.max.z - centre.z + 0.5,
        ),
      );
      const radius = Math.max(1.5, localBounds.getBoundingSphere(new Sphere()).radius);
      const distance = Math.max(5, radius * 2.65);
      const camera = new PerspectiveCamera(42, 1, Math.max(0.01, radius / 2000), distance * 25);

      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = false;
      controls.screenSpacePanning = true;
      controls.minDistance = Math.max(0.25, radius * 0.06);
      controls.maxDistance = distance * 8;

      const runtime: PreviewRuntime = {
        renderer,
        scene,
        camera,
        controls,
        viewport,
        meshGroups: [],
        groupsByState: new Map(),
        centre,
        distance,
        render: () => {
          viewport.dataset.cameraDistance = cameraDistance(runtime).toFixed(6);
          renderer?.render(scene, camera);
        },
      };
      runtimeRef.current = runtime;
      renderScene = runtime.render;
      controls.addEventListener("change", renderScene);
      configurePerspective(runtime);

      boundsHelper = new Box3Helper(localBounds, 0x7eebb2);
      scene.add(boundsHelper);

      const width = Math.max(1, bounds.max.x - bounds.min.x + 1);
      const depth = Math.max(1, bounds.max.z - bounds.min.z + 1);
      const gridSize = Math.max(10, Math.ceil(Math.max(width, depth) / 10) * 10);
      const gridDivisions = Math.min(100, Math.max(10, Math.round(gridSize)));
      grid = new GridHelper(gridSize, gridDivisions, 0x3b7659, 0x173528);
      grid.position.y = bounds.min.y - centre.y - 0.51;
      scene.add(grid);

      const resize = () => {
        const widthPx = Math.max(1, viewport.clientWidth);
        const heightPx = Math.max(1, viewport.clientHeight);
        renderer?.setSize(widthPx, heightPx, false);
        camera.aspect = widthPx / heightPx;
        camera.updateProjectionMatrix();
        runtime.render();
      };
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(viewport);
      resize();

      const initialiseModels = async () => {
        if (preview.sampledBlockCount === 0) return;

        setModelStatus({
          phase: "loading",
          message: "",
        });
        try {
          const resources = await loadMojangResources({
            states: preview.states,
            signal: abortController.signal,
            useXkrd,
          });
          if (abortController.signal.aborted) return;
          addMinecraftMeshes(runtime, owned, preview, resources);
          updateMeshGroups(runtime, preview, layerRangeRef.current);
          setModelStatus({
            phase: "ready",
            message: "",
          });
        } catch (error) {
          if (abortController.signal.aborted) return;
          const fallbackStates = addFallbackMeshes(
            runtime,
            owned,
            preview,
            capacitiesByState(preview),
          );
          updateMeshGroups(runtime, preview, layerRangeRef.current);
          setModelStatus({
            phase: "fallback",
            message: `${fallbackMessage(error)}（${fallbackStates} 种状态）`,
          });
        }
      };
      void initialiseModels();
    } catch (error) {
      const message =
        error instanceof Error
          ? `无法启动 3D 预览：${error.message}`
          : "当前浏览器无法启动 WebGL 3D 预览。";
      errorTimer = window.setTimeout(() => setWebglError(message), 0);
    }

    return () => {
      abortController.abort();
      runtimeRef.current = null;
      if (errorTimer !== null) window.clearTimeout(errorTimer);
      resizeObserver?.disconnect();
      if (controls && renderScene) controls.removeEventListener("change", renderScene);
      controls?.dispose();
      owned.geometries.forEach((geometry) => geometry.dispose());
      owned.materials.forEach((material) => material.dispose());
      owned.textures.forEach((texture) => texture.dispose());
      boundsHelper?.geometry.dispose();
      if (boundsHelper) disposeMaterials(boundsHelper.material);
      grid?.geometry.dispose();
      if (grid) disposeMaterials(grid.material);
      renderer?.dispose();
      renderer?.domElement.remove();
    };
  }, [bounds, preview, useXkrd]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    updateMeshGroups(runtime, preview, layerRange);
  }, [layerRange, preview]);

  const setZoom = (factor: number) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const offset = runtime.camera.position.clone().sub(runtime.controls.target);
    const nextDistance = clampCameraDistance(
      offset.length(),
      factor,
      runtime.controls.minDistance,
      runtime.controls.maxDistance,
    );
    if (nextDistance <= 0 || !Number.isFinite(nextDistance)) return;
    offset.setLength(nextDistance);
    runtime.camera.position.copy(runtime.controls.target).add(offset);
    runtime.controls.update();
  };

  const showTop = () => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.camera.up.set(0, 0, -1);
    runtime.camera.position.set(0, runtime.distance * 1.15, 0.001);
    runtime.controls.target.set(0, 0, 0);
    runtime.controls.update();
  };

  const requestFullscreen = () => {
    const viewport = viewportRef.current;
    if (!viewport?.requestFullscreen) return;
    void viewport.requestFullscreen().catch(() => setWebglError("浏览器拒绝进入全屏模式。"));
  };

  const runCameraAction = (event: ReactMouseEvent<HTMLButtonElement>, action: () => void) => {
    action();
    event.currentTarget.blur();
  };

  return (
    <section className="schematic-preview" aria-labelledby="schematic-preview-title">
      <div className="schematic-preview__heading">
        <div>
          <span className="eyebrow">TEST · SCHEMATIC VIEWER</span>
          <h2 id="schematic-preview-title">原理图方块模型预览</h2>
          <p>左键旋转 · 滚轮缩放 · 右键平移；可查看全部、单层或任意连续多层。</p>
        </div>
        <div className="schematic-preview__summary" aria-live="polite">
          <strong>{integerFormatter.format(visibleCount)}</strong>
          <span>当前显示 / 保留 {integerFormatter.format(preview.sampledBlockCount)}</span>
        </div>
      </div>

      <div className="schematic-preview__layout">
        <aside className="schematic-preview__controls" aria-label="预览控制">
          <fieldset>
            <legend>显示层</legend>
            <div className="preview-mode-tabs">
              {(
                [
                  ["all", "全部"],
                  ["single", "单层"],
                  ["range", "多层"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={mode === value}
                  onClick={() => setMode(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>

          {mode === "single" ? (
            <fieldset>
              <legend>Y 层</legend>
              <div className="preview-layer-stepper">
                <button
                  type="button"
                  aria-label="上一层"
                  disabled={singleLayer <= minimumY}
                  onClick={() => setSingleLayer((value) => Math.max(minimumY, value - 1))}
                >
                  −
                </button>
                <output>Y = {singleLayer}</output>
                <button
                  type="button"
                  aria-label="下一层"
                  disabled={singleLayer >= maximumY}
                  onClick={() => setSingleLayer((value) => Math.min(maximumY, value + 1))}
                >
                  +
                </button>
              </div>
              <input
                aria-label="选择单层高度"
                type="range"
                min={minimumY}
                max={maximumY}
                value={singleLayer}
                onChange={(event) => setSingleLayer(Number(event.target.value))}
              />
            </fieldset>
          ) : null}

          {mode === "range" ? (
            <fieldset>
              <legend>连续层范围</legend>
              <div className="preview-range-fields">
                <label>
                  从 Y
                  <input
                    type="number"
                    min={minimumY}
                    max={maximumY}
                    value={rangeStart}
                    onChange={(event) => setRangeStart(Number(event.target.value))}
                  />
                </label>
                <label>
                  到 Y
                  <input
                    type="number"
                    min={minimumY}
                    max={maximumY}
                    value={rangeEnd}
                    onChange={(event) => setRangeEnd(Number(event.target.value))}
                  />
                </label>
              </div>
              <input
                aria-label="多层起始高度"
                type="range"
                min={minimumY}
                max={maximumY}
                value={rangeStart}
                onChange={(event) => setRangeStart(Number(event.target.value))}
              />
              <input
                aria-label="多层结束高度"
                type="range"
                min={minimumY}
                max={maximumY}
                value={rangeEnd}
                onChange={(event) => setRangeEnd(Number(event.target.value))}
              />
              <small>
                当前 Y {layerRange.min} 至 {layerRange.max}，共{" "}
                {layerRange.max - layerRange.min + 1} 层
              </small>
            </fieldset>
          ) : null}

          <fieldset>
            <legend>预览材质</legend>
            <label className="preview-resource-toggle">
              <input
                type="checkbox"
                role="switch"
                aria-label="启用 XK 红显"
                aria-describedby="xkrd-preview-description"
                checked={useXkrd}
                onChange={(event) => setUseXkrd(event.target.checked)}
              />
              <span className="preview-resource-toggle__track" aria-hidden="true">
                <span />
              </span>
              <span className="preview-resource-toggle__copy">
                <strong>启用 XK 红显</strong>
                <small>{useXkrd ? "已开启" : "默认关闭"}</small>
              </span>
            </label>
            <small id="xkrd-preview-description">
              开启后按原理图方块状态优先使用 XK 红显；包内缺失或异常的状态仍使用原版 1.21.11
              模型与纹理。
            </small>
          </fieldset>

          <fieldset>
            <legend>视角（单次动作）</legend>
            <div className="preview-view-buttons">
              <button
                type="button"
                onClick={(event) => runCameraAction(event, () => setZoom(0.78))}
                aria-label="放大"
              >
                放大
              </button>
              <button
                type="button"
                onClick={(event) => runCameraAction(event, () => setZoom(1.28))}
                aria-label="缩小"
              >
                缩小
              </button>
              <button
                type="button"
                onClick={(event) =>
                  runCameraAction(event, () => {
                    const runtime = runtimeRef.current;
                    if (runtime) configurePerspective(runtime);
                  })
                }
              >
                重置
              </button>
              <button type="button" onClick={(event) => runCameraAction(event, showTop)}>
                顶视
              </button>
              <button type="button" onClick={(event) => runCameraAction(event, requestFullscreen)}>
                全屏
              </button>
            </div>
          </fieldset>

          <dl className="preview-bounds">
            <div>
              <dt>坐标范围</dt>
              <dd>
                X {bounds ? `${bounds.min.x}–${bounds.max.x}` : "—"}
                <br />Y {bounds ? `${bounds.min.y}–${bounds.max.y}` : "—"}
                <br />Z {bounds ? `${bounds.min.z}–${bounds.max.z}` : "—"}
              </dd>
            </div>
            <div>
              <dt>非空气方块</dt>
              <dd>{integerFormatter.format(preview.totalBlockCount)}</dd>
            </div>
          </dl>
        </aside>

        <div
          ref={viewportRef}
          className="schematic-preview__viewport"
          role="img"
          aria-label={`原理图三维方块模型预览，当前显示 Y ${layerRange.min} 至 ${layerRange.max}`}
          data-model-phase={modelStatus.phase}
        >
          {!bounds ? (
            <p className="preview-empty">投影缺少可定位的 Region，无法生成空间预览。</p>
          ) : null}
          {bounds && preview.sampledBlockCount === 0 ? (
            <p className="preview-empty">这个投影没有可显示的非空气方块。</p>
          ) : null}
          <div className="preview-axis" aria-hidden="true">
            <span className="preview-axis--x">X</span>
            <span className="preview-axis--y">Y</span>
            <span className="preview-axis--z">Z</span>
          </div>
        </div>
      </div>

      {preview.truncated ? (
        <p className="schematic-preview__notice">
          为保证浏览器流畅，模型预览保留了 {integerFormatter.format(preview.sampledBlockCount)} /{" "}
          {integerFormatter.format(preview.totalBlockCount)} 个非空气方块；完整材料统计和 Region
          层边界不受影响。
        </p>
      ) : null}
      {webglError ? (
        <p className="schematic-preview__notice schematic-preview__notice--error" role="alert">
          {webglError}
        </p>
      ) : null}
      {modelStatus.phase === "fallback" && modelStatus.message ? (
        <p className="schematic-preview__notice" role="status">
          {modelStatus.message}
        </p>
      ) : null}
      <p className="schematic-preview__footnote">
        预览固定使用随站点提供的 Minecraft 1.21.11 模型与纹理，投影文件不会上传；标准 JSON
        方块模型会保留元素、纹理、朝向和透明面，需要客户端动态渲染或非标准 Mod loader
        的状态会明确降级为彩色占位。XK 红显 v3.3 由 Xe_Kr 制作，按 CC BY-NC-ND 4.0 原样提供；
        <a
          href="https://www.planetminecraft.com/texture-pack/redstone-display-5793327/"
          target="_blank"
          rel="noreferrer"
        >
          查看作者原帖
        </a>
        。
      </p>
    </section>
  );
}
