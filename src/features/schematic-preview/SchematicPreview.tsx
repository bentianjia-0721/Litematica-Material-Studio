import { useEffect, useMemo, useRef, useState } from "react";
import {
  AmbientLight,
  Box3,
  Box3Helper,
  BoxGeometry,
  Color,
  DirectionalLight,
  DynamicDrawUsage,
  GridHelper,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  type Material,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  Sphere,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { LitematicPreview } from "../../lib/litematic";
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
  readonly mesh: InstancedMesh<BoxGeometry, MeshBasicMaterial>;
}

interface PreviewRuntime {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly meshGroups: readonly PreviewMeshGroup[];
  readonly groupByColour: ReadonlyMap<number, PreviewMeshGroup>;
  readonly centre: Vector3;
  readonly distance: number;
  readonly colours: readonly number[];
}

const integerFormatter = new Intl.NumberFormat("zh-CN");
const fallbackVoxelColour = 0x8aa99a;

function configurePerspective(runtime: PreviewRuntime) {
  const { camera, controls, distance } = runtime;
  camera.up.set(0, 1, 0);
  camera.position.set(distance * 0.78, distance * 0.62, distance * 0.78);
  controls.target.set(0, 0, 0);
  controls.update();
}

function disposeMaterials(material: Material | Material[]) {
  if (Array.isArray(material)) material.forEach((item) => item.dispose());
  else material.dispose();
}

function updateMeshGroups(
  runtime: PreviewRuntime,
  preview: LitematicPreview,
  layerRange: PreviewLayerRange,
) {
  const { meshGroups, groupByColour, centre, colours } = runtime;
  const visibleCounts = new Map<PreviewMeshGroup, number>();
  meshGroups.forEach((group) => visibleCounts.set(group, 0));
  const matrix = new Matrix4();

  for (let sourceIndex = 0; sourceIndex < preview.sampledBlockCount; sourceIndex += 1) {
    const offset = sourceIndex * 3;
    const x = preview.positions[offset];
    const y = preview.positions[offset + 1];
    const z = preview.positions[offset + 2];
    if (x === undefined || y === undefined || z === undefined) continue;
    if (y < layerRange.min || y > layerRange.max) continue;

    const stateIndex = preview.stateIndices[sourceIndex] ?? 0;
    const group = groupByColour.get(colours[stateIndex] ?? fallbackVoxelColour);
    if (!group) continue;
    const visibleCount = visibleCounts.get(group) ?? 0;
    matrix.makeTranslation(x - centre.x, y - centre.y, z - centre.z);
    group.mesh.setMatrixAt(visibleCount, matrix);
    visibleCounts.set(group, visibleCount + 1);
  }

  for (const group of meshGroups) {
    group.mesh.count = visibleCounts.get(group) ?? 0;
    group.mesh.instanceMatrix.needsUpdate = true;
  }
  runtime.renderer.render(runtime.scene, runtime.camera);
}

export function SchematicPreview({ preview }: SchematicPreviewProps) {
  const bounds = preview.bounds;
  const minimumY = bounds?.min.y ?? 0;
  const maximumY = bounds?.max.y ?? 0;
  const [mode, setMode] = useState<PreviewLayerMode>("all");
  const [singleLayer, setSingleLayer] = useState(maximumY);
  const [rangeStart, setRangeStart] = useState(minimumY);
  const [rangeEnd, setRangeEnd] = useState(maximumY);
  const [webglError, setWebglError] = useState<string | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<PreviewRuntime | null>(null);

  const layerRange = useMemo(
    () =>
      bounds
        ? resolveLayerRange({ mode, singleLayer, rangeStart, rangeEnd }, bounds)
        : { min: 0, max: 0 },
    [bounds, mode, rangeEnd, rangeStart, singleLayer],
  );

  const visibleCount = useMemo(
    () => countVisibleBlocks(preview.positions, layerRange),
    [layerRange, preview.positions],
  );

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !bounds) return;

    let renderer: WebGLRenderer | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let controls: OrbitControls | null = null;
    let geometry: BoxGeometry | null = null;
    const voxelMaterials: MeshBasicMaterial[] = [];
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
      scene.add(new AmbientLight(0xffffff, 1.35));
      scene.add(new HemisphereLight(0xd9ffec, 0x254d3a, 1.8));
      const directional = new DirectionalLight(0xffffff, 2.25);
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

      geometry = new BoxGeometry(0.92, 0.92, 0.92);
      const colours = preview.states.map(blockStateColor);
      const capacityByColour = new Map<number, number>();
      for (let index = 0; index < preview.sampledBlockCount; index += 1) {
        const stateIndex = preview.stateIndices[index] ?? 0;
        const colour = colours[stateIndex] ?? fallbackVoxelColour;
        capacityByColour.set(colour, (capacityByColour.get(colour) ?? 0) + 1);
      }
      const meshGroups: PreviewMeshGroup[] = [];
      const groupByColour = new Map<number, PreviewMeshGroup>();
      for (const [colour, capacity] of capacityByColour) {
        const voxelMaterial = new MeshBasicMaterial({ color: colour, toneMapped: false });
        voxelMaterials.push(voxelMaterial);
        const mesh = new InstancedMesh(geometry, voxelMaterial, Math.max(1, capacity));
        mesh.instanceMatrix.setUsage(DynamicDrawUsage);
        mesh.count = 0;
        mesh.frustumCulled = false;
        scene.add(mesh);
        const group: PreviewMeshGroup = { mesh };
        meshGroups.push(group);
        groupByColour.set(colour, group);
      }

      boundsHelper = new Box3Helper(localBounds, 0x7eebb2);
      scene.add(boundsHelper);

      const width = Math.max(1, bounds.max.x - bounds.min.x + 1);
      const depth = Math.max(1, bounds.max.z - bounds.min.z + 1);
      const gridSize = Math.max(10, Math.ceil(Math.max(width, depth) / 10) * 10);
      const gridDivisions = Math.min(100, Math.max(10, Math.round(gridSize)));
      grid = new GridHelper(gridSize, gridDivisions, 0x3b7659, 0x173528);
      grid.position.y = bounds.min.y - centre.y - 0.51;
      scene.add(grid);

      const runtime: PreviewRuntime = {
        renderer,
        scene,
        camera,
        controls,
        meshGroups,
        groupByColour,
        centre,
        distance,
        colours,
      };
      runtimeRef.current = runtime;
      renderScene = () => renderer?.render(scene, camera);
      controls.addEventListener("change", renderScene);
      configurePerspective(runtime);

      const resize = () => {
        const widthPx = Math.max(1, viewport.clientWidth);
        const heightPx = Math.max(1, viewport.clientHeight);
        renderer?.setSize(widthPx, heightPx, false);
        camera.aspect = widthPx / heightPx;
        camera.updateProjectionMatrix();
        renderScene?.();
      };
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(viewport);
      resize();
    } catch (error) {
      const message =
        error instanceof Error
          ? `无法启动 3D 预览：${error.message}`
          : "当前浏览器无法启动 WebGL 3D 预览。";
      errorTimer = window.setTimeout(() => setWebglError(message), 0);
    }

    return () => {
      runtimeRef.current = null;
      if (errorTimer !== null) window.clearTimeout(errorTimer);
      resizeObserver?.disconnect();
      if (controls && renderScene) controls.removeEventListener("change", renderScene);
      controls?.dispose();
      geometry?.dispose();
      voxelMaterials.forEach((material) => material.dispose());
      boundsHelper?.geometry.dispose();
      if (boundsHelper) disposeMaterials(boundsHelper.material);
      grid?.geometry.dispose();
      if (grid) disposeMaterials(grid.material);
      renderer?.dispose();
      renderer?.domElement.remove();
    };
  }, [bounds, preview]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    updateMeshGroups(runtime, preview, layerRange);
  }, [layerRange, preview]);

  const setZoom = (factor: number) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const offset = runtime.camera.position
      .clone()
      .sub(runtime.controls.target)
      .multiplyScalar(factor);
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

  return (
    <section className="schematic-preview" aria-labelledby="schematic-preview-title">
      <div className="schematic-preview__heading">
        <div>
          <span className="eyebrow">TEST · SCHEMATIC VIEWER</span>
          <h2 id="schematic-preview-title">原理图体素预览</h2>
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
            <legend>视角</legend>
            <div className="preview-view-buttons">
              <button type="button" onClick={() => setZoom(0.78)} aria-label="放大">
                放大
              </button>
              <button type="button" onClick={() => setZoom(1.28)} aria-label="缩小">
                缩小
              </button>
              <button
                type="button"
                onClick={() => {
                  const runtime = runtimeRef.current;
                  if (runtime) configurePerspective(runtime);
                }}
              >
                重置
              </button>
              <button type="button" onClick={showTop}>
                顶视
              </button>
              <button type="button" onClick={requestFullscreen}>
                全屏
              </button>
            </div>
          </fieldset>

          <dl className="preview-bounds">
            <div>
              <dt>坐标范围</dt>
              <dd>
                X {bounds ? `${bounds.min.x}…${bounds.max.x}` : "—"}
                <br />Y {bounds ? `${bounds.min.y}…${bounds.max.y}` : "—"}
                <br />Z {bounds ? `${bounds.min.z}…${bounds.max.z}` : "—"}
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
          aria-label={`原理图三维体素预览，当前显示 Y ${layerRange.min} 至 ${layerRange.max}`}
        >
          {!bounds ? (
            <p className="preview-empty">投影缺少可定位的 Region，无法生成空间预览。</p>
          ) : null}
          {bounds && preview.sampledBlockCount === 0 ? (
            <p className="preview-empty">这个投影没有可显示的非空气方块。</p>
          ) : null}
          {webglError ? <p className="preview-empty preview-empty--error">{webglError}</p> : null}
          <div className="preview-axis" aria-hidden="true">
            <span className="preview-axis--x">X</span>
            <span className="preview-axis--y">Y</span>
            <span className="preview-axis--z">Z</span>
          </div>
        </div>
      </div>

      {preview.truncated ? (
        <p className="schematic-preview__notice">
          为保证浏览器流畅，体素预览保留了 {integerFormatter.format(preview.sampledBlockCount)} /{" "}
          {integerFormatter.format(preview.totalBlockCount)} 个非空气方块；完整材料统计和 Region
          层边界不受影响。
        </p>
      ) : null}
      <p className="schematic-preview__footnote">
        当前为高性能彩色体素预览；可核对空间结构与层高，但不还原 Minecraft
        的方块纹理、朝向和复杂模型。
      </p>
    </section>
  );
}
