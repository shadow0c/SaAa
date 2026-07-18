// src/App.tsx
import { useEffect, useRef, useState, useCallback } from 'react';
import { EditorViewport, type EditorEntityUserData, type ShaderPreset } from './EditorViewport';
import type { EngineEntity } from '@game-engine/core';
import type { AssetRecord } from '@game-engine/core/assets';

const BRIDGE_URL = (import.meta as unknown as { env: Record<string, string> }).env?.VITE_BRIDGE_URL ?? 'ws://localhost:8787';

const KIND_LABEL: Record<string, string> = {
  box: 'Kutu', spawnPoint: 'Spawn', bombsite: 'Bombsite', light: 'Işık', model: 'Model',
};

export function App() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorViewport | null>(null);

  const [entities, setEntities] = useState<EngineEntity[]>([]);
  const [selected, setSelected] = useState<EngineEntity | null>(null);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [mode, setMode] = useState<'translate' | 'rotate' | 'scale'>('translate');
  const [status, setStatus] = useState('Hazır.');
  const [bridgeConnected, setBridgeConnected] = useState(false);

  const modelInputRef = useRef<HTMLInputElement>(null);
  const textureInputRef = useRef<HTMLInputElement>(null);

  const refreshEntities = useCallback(() => {
    setEntities(editorRef.current?.engine.listEntities() ?? []);
  }, []);

  useEffect(() => {
    const editor = new EditorViewport();
    editorRef.current = editor;
    if (viewportRef.current) editor.mount(viewportRef.current);

    editor.onSelectionChange = (e) => setSelected(e);
    editor.onSceneChange = () => refreshEntities();
    refreshEntities();

    const bridge = editor.connectBridge(BRIDGE_URL);
    const checkInterval = setInterval(() => setBridgeConnected(bridge.isConnected()), 1000);

    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'w' || e.key === 'W') { setMode('translate'); editor.setTransformMode('translate'); }
      if (e.key === 'e' || e.key === 'E') { setMode('rotate'); editor.setTransformMode('rotate'); }
      if (e.key === 'r' || e.key === 'R') { setMode('scale'); editor.setTransformMode('scale'); }
      if (e.key === 'Delete' || e.key === 'Backspace') editor.removeSelected();
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      clearInterval(checkInterval);
      window.removeEventListener('keydown', onKeyDown);
      editor.unmount();
      editorRef.current = null;
    };
  }, [refreshEntities]);

  const handleImportModel = async (file: File) => {
    setStatus(`İçe aktarılıyor: ${file.name}...`);
    try {
      const record = await editorRef.current!.engine.assets.importModelFile(file);
      setAssets(editorRef.current!.engine.assets.list());
      const r = record.report!;
      setStatus(`Import OK: ${file.name} | ${r.triangles} üçgen | ${r.materials} malzeme | ~${(r.textureBytesEstimate / (1024 * 1024)).toFixed(1)}MB doku`);
    } catch (err) {
      setStatus(`Model import hatası: ${(err as Error).message}`);
    }
  };

  const handleImportTexture = async (file: File) => {
    try {
      await editorRef.current!.engine.assets.importTextureFile(file);
      setAssets(editorRef.current!.engine.assets.list());
      setStatus(`Doku eklendi: ${file.name}`);
    } catch (err) {
      setStatus(`Doku import hatası: ${(err as Error).message}`);
    }
  };

  const handleExportJSON = () => {
    const scene = editorRef.current!.exportScene();
    const blob = new Blob([JSON.stringify(scene, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'sahne.json'; a.click();
    URL.revokeObjectURL(url);
    setStatus('Sahne JSON olarak indirildi.');
  };

  return (
    <div className="editor-root">
      <div className="toolbar">
        <span className="toolbar-title">Sahne Editörü</span>

        <div className="dropdown">
          <button className="btn btn-secondary">+ Ekle ▾</button>
          <div className="dropdown-content">
            <button onClick={() => editorRef.current?.addBox(true, 'wall')}>Kutu (Solid / Duvar)</button>
            <button onClick={() => editorRef.current?.addBox(false, 'plastic')}>Prop (Solid olmayan)</button>
            <hr />
            <button onClick={() => editorRef.current?.addSpawnPoint('t')}>T Spawn</button>
            <button onClick={() => editorRef.current?.addSpawnPoint('ct')}>CT Spawn</button>
            <button onClick={() => editorRef.current?.addBombsite('A')}>Bombsite A</button>
            <button onClick={() => editorRef.current?.addBombsite('B')}>Bombsite B</button>
            <hr />
            <button onClick={() => editorRef.current?.addLight()}>Işık</button>
            <hr />
            <button onClick={() => modelInputRef.current?.click()}>Model İçe Aktar (.glb/.gltf)</button>
            <button onClick={() => textureInputRef.current?.click()}>Doku İçe Aktar (.png/.jpg)</button>
          </div>
        </div>

        <div className="toggle-group">
          {(['translate', 'rotate', 'scale'] as const).map((m) => (
            <button key={m} className={`toggle-btn ${mode === m ? 'active' : ''}`}
              onClick={() => { setMode(m); editorRef.current?.setTransformMode(m); }}>
              {m === 'translate' ? 'Taşı' : m === 'rotate' ? 'Döndür' : 'Ölçek'}
            </button>
          ))}
        </div>

        <div className="divider" />
        <button className="btn btn-ghost" onClick={handleExportJSON}>Kaydet (JSON)</button>
        <button className="btn btn-ghost" onClick={() => editorRef.current?.requestSceneFromGame()}>Oyundan Sahneyi Çek</button>
        <div className="divider" />
        <button className="btn btn-danger" onClick={() => editorRef.current?.removeSelected()}>Seçiliyi Sil (Del)</button>

        <span className={`bridge-status ${bridgeConnected ? 'connected' : ''}`}>
          {bridgeConnected ? '● Oyuna bağlı' : '○ Oyun bağlantısı yok'}
        </span>
        <span className="status-text">{status}</span>

        <input ref={modelInputRef} type="file" accept=".glb,.gltf" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImportModel(f); e.target.value = ''; }} />
        <input ref={textureInputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImportTexture(f); e.target.value = ''; }} />
      </div>

      <div className="body">
        <div className="panel hierarchy">
          <div className="panel-header">Hierarchy ({entities.length})</div>
          <div className="panel-content">
            {entities.map((e) => (
              <button key={e.id} className={`hierarchy-item ${selected?.id === e.id ? 'active' : ''}`}
                onClick={() => editorRef.current?.select(e.id)}>
                <span className="truncate">{e.name}</span>
                <span className="kind-tag">{KIND_LABEL[String(e.userData.__kind)] ?? '?'}</span>
              </button>
            ))}
            {entities.length === 0 && <div className="empty-hint">Sahne boş. "+ Ekle" ile başla.</div>}
          </div>
        </div>

        <div className="viewport-wrap">
          <div ref={viewportRef} className="viewport" />
          <div className="viewport-hint">Sol tık: seç · Sürükle: orbit · Sağ tık: pan · Tekerlek: zoom · W/E/R: mod</div>
        </div>

        <div className="panel inspector">
          <div className="panel-header">Inspector</div>
          <div className="panel-content">
            {!selected ? <div className="empty-hint">Bir nesne seç.</div> : <InspectorFields entity={selected} editor={editorRef.current!} />}
          </div>
        </div>
      </div>

      <div className="panel asset-browser">
        <div className="panel-header">Asset Browser ({assets.length})</div>
        <div className="asset-list">
          {assets.map((a) => (
            <div key={a.id} className="asset-card">
              <div className="asset-thumb">{a.kind === 'model' ? '3D' : 'IMG'}</div>
              <span className="truncate">{a.name}</span>
              {a.kind === 'model' && (
                <button className="btn btn-secondary btn-xs" onClick={() => editorRef.current?.addModelInstance(a.id, a.name)}>
                  Sahneye Koy
                </button>
              )}
            </div>
          ))}
          {assets.length === 0 && <div className="empty-hint">Henüz asset import edilmedi.</div>}
        </div>
      </div>
    </div>
  );
}

function InspectorFields({ entity, editor }: { entity: EngineEntity; editor: EditorViewport }) {
  const ud = entity.userData as EditorEntityUserData;
  const t = entity.transform;

  const patchTransform = (patch: Partial<typeof t>) => editor.updateSelectedTransform(patch);
  const patchUserData = (patch: Partial<EditorEntityUserData>) => editor.updateSelectedUserData(patch);

  return (
    <div className="inspector-fields">
      <div className="field-group">
        <label>Konum</label>
        <div className="grid3">
          <input type="number" value={t.position.x} onChange={(e) => patchTransform({ position: { ...t.position, x: +e.target.value } })} />
          <input type="number" value={t.position.y} onChange={(e) => patchTransform({ position: { ...t.position, y: +e.target.value } })} />
          <input type="number" value={t.position.z} onChange={(e) => patchTransform({ position: { ...t.position, z: +e.target.value } })} />
        </div>
      </div>

      <div className="field-group">
        <label>Döndür Y°</label>
        <input type="number" value={t.rotationY} onChange={(e) => patchTransform({ rotationY: +e.target.value })} />
      </div>

      <div className="field-group">
        <label>Ölçek</label>
        <div className="grid3">
          <input type="number" step={0.1} value={t.scale.x} onChange={(e) => patchTransform({ scale: { ...t.scale, x: +e.target.value } })} />
          <input type="number" step={0.1} value={t.scale.y} onChange={(e) => patchTransform({ scale: { ...t.scale, y: +e.target.value } })} />
          <input type="number" step={0.1} value={t.scale.z} onChange={(e) => patchTransform({ scale: { ...t.scale, z: +e.target.value } })} />
        </div>
      </div>

      <hr />

      {ud.__kind === 'box' && (
        <>
          <div className="field-group">
            <label>Shader / Malzeme Ön Ayarı</label>
            <select value={ud.shader ?? 'wall'} onChange={(e) => patchUserData({ shader: e.target.value as ShaderPreset })}>
              <option value="wall">Duvar (mat, GGX dağınık)</option>
              <option value="metal">Metal (parlak, GGX speküler)</option>
              <option value="plastic">Plastik</option>
            </select>
          </div>
          <div className="field-group">
            <label>Renk</label>
            <input type="color" value={ud.color ?? '#8a8f98'} onChange={(e) => patchUserData({ color: e.target.value })} />
          </div>
          <label className="checkbox-row">
            <input type="checkbox" checked={ud.solid ?? true} onChange={(e) => patchUserData({ solid: e.target.checked })} />
            Solid (oyuncu içinden geçemez)
          </label>
        </>
      )}

      {ud.__kind === 'light' && (
        <>
          <div className="field-group">
            <label>Renk</label>
            <input type="color" value={ud.color ?? '#ffe0b0'} onChange={(e) => patchUserData({ color: e.target.value })} />
          </div>
          <div className="field-group">
            <label>Yoğunluk</label>
            <input type="number" step={0.1} value={ud.intensity ?? 2} onChange={(e) => patchUserData({ intensity: +e.target.value })} />
          </div>
        </>
      )}

      {ud.__kind === 'spawnPoint' && <div className="readonly-field">Takım: {ud.team === 't' ? 'Terörist' : 'Counter-Terörist'}</div>}
      {ud.__kind === 'bombsite' && <div className="readonly-field">Etiket: {ud.label}</div>}
      {ud.__kind === 'model' && <div className="readonly-field">Asset: {ud.assetName}</div>}
    </div>
  );
}
