import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { USDLoader } from 'three/addons/loaders/USDLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { VertexNormalsHelper } from 'three/addons/helpers/VertexNormalsHelper.js';

const DEFAULT_INSPECTOR_SETTINGS = {
  viewport: '3d',
  renderMode: 'final',
  materialChannel: 'final',
  geometryMode: 'none',
  wireframe: { enabled: false, color: '#ffffff', opacity: 0.55 },
  singleSided: false,
  bones: false,
  boneInfluence: false,
};

function toAssetUrl(filePath) {
  if (!filePath) return '';
  if (/^(data|blob|https?):/i.test(filePath)) return filePath;
  if (filePath.startsWith('asset-file://')) return filePath;
  return `asset-file://local/?path=${encodeURIComponent(filePath)}`;
}

function resolveSiblingPath(modelDir, url) {
  if (!url || /^(data|blob|https?|asset-file):/i.test(url)) return url;
  if (url.includes('node_modules/three/') || url.includes('draco/')) return url;
  const decoded = decodeURIComponent(url);
  if (/^[A-Za-z]:[\\/]/.test(decoded) || decoded.startsWith('/')) return decoded;
  const normalizedDir = modelDir.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedUrl = decoded.replace(/\\/g, '/').replace(/^\.\/+/, '');
  return `${normalizedDir}/${normalizedUrl}`;
}

function createStudioEnvironment() {
  const width = 64;
  const height = 32;
  const data = new Float32Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    const v = y / (height - 1);
    for (let x = 0; x < width; x++) {
      const u = x / (width - 1);
      const key = Math.max(0, 1 - Math.hypot(u - 0.26, v - 0.34) * 3.0);
      const rim = Math.max(0, 1 - Math.hypot(u - 0.72, v - 0.42) * 4.0);
      const floor = Math.max(0, v - 0.58) * 0.55;
      const sky = 0.36 + (1 - v) * 0.72;
      const i = (y * width + x) * 4;
      data[i] = sky + key * 3.0 + rim * 0.85 + floor;
      data[i + 1] = sky + key * 2.8 + rim * 0.95 + floor;
      data[i + 2] = sky + key * 2.55 + rim * 1.15 + floor;
      data[i + 3] = 1;
    }
  }

  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.needsUpdate = true;
  return texture;
}

function firstTextureByType(textures = []) {
  return textures.reduce((acc, texture) => {
    if (texture?.map_type && texture?.file_path && !acc[texture.map_type]) {
      acc[texture.map_type] = texture.file_path;
    }
    return acc;
  }, {});
}

function materialHasTexture(material) {
  if (!material) return false;
  return Boolean(
    material.map ||
    material.normalMap ||
    material.roughnessMap ||
    material.metalnessMap ||
    material.aoMap ||
    material.emissiveMap ||
    material.alphaMap ||
    material.bumpMap ||
    material.displacementMap
  );
}

function isNearBlackMaterial(material) {
  if (!material || materialHasTexture(material)) return false;
  const color = material.color || material.emissive || null;
  if (!color) return true;
  return Math.max(color.r ?? 0, color.g ?? 0, color.b ?? 0) < 0.04;
}

function shouldUseAutoMaterial(material) {
  if (!material) return true;
  if (Array.isArray(material)) return material.length === 0;
  if (materialHasTexture(material)) return false;
  return isNearBlackMaterial(material);
}

function ensureUv2(geometry) {
  if (!geometry?.attributes?.uv || geometry.attributes.uv2) return;
  geometry.setAttribute('uv2', geometry.attributes.uv.clone());
}

function asMaterialArray(material) {
  if (!material) return [];
  return Array.isArray(material) ? material : [material];
}

function firstMaterial(material) {
  return asMaterialArray(material)[0] || null;
}

function createUvCheckerTexture() {
  const size = 256;
  const cell = 32;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const check = (Math.floor(x / cell) + Math.floor(y / cell)) % 2;
      const i = (y * size + x) * 4;
      const c = check ? 230 : 42;
      data[i] = c;
      data[i + 1] = check ? 230 : 44;
      data[i + 2] = check ? 230 : 52;
      data[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

function createMatcapTexture() {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x / (size - 1)) * 2 - 1;
      const ny = (y / (size - 1)) * 2 - 1;
      const r = Math.sqrt(nx * nx + ny * ny);
      const shade = Math.max(0, 1 - r);
      const rim = Math.max(0, 1 - Math.abs(r - 0.7) * 4);
      const i = (y * size + x) * 4;
      data[i] = Math.min(255, 42 + shade * 180 + rim * 32);
      data[i + 1] = Math.min(255, 52 + shade * 170 + rim * 48);
      data[i + 2] = Math.min(255, 66 + shade * 150 + rim * 70);
      data[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createSolidTexture(color) {
  const c = new THREE.Color(color);
  const data = new Uint8Array([
    Math.round(c.r * 255),
    Math.round(c.g * 255),
    Math.round(c.b * 255),
    255,
  ]);
  const texture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function withTimeout(promise, label, ms = 45000) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

export default function ModelViewer3D({
  model,
  onClose,
  inspectorSettings = DEFAULT_INSPECTOR_SETTINGS,
  onCapabilitiesChange,
  isFullscreen = false,
  onToggleFullscreen,
  onThumbnailSaved,
}) {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const controlsRef = useRef(null);
  const modelRef = useRef(null);
  const mixerRef = useRef(null);
  const animationActionsRef = useRef([]);
  const animationsRef = useRef([]);
  const animRef = useRef(null);
  const pmremRef = useRef(null);
  const environmentRef = useRef(null);
  const inspectorHelperRef = useRef(null);
  const wireHelperRef = useRef(null);
  const textureCacheRef = useRef(new Map());
  const uvCheckerRef = useRef(null);
  const matcapRef = useRef(null);
  const loadTokenRef = useRef(0);

  const [sceneReady, setSceneReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [autoRotate, setAutoRotate] = useState(true);
  const [animationMode, setAnimationMode] = useState('auto');
  const [hasAnimations, setHasAnimations] = useState(false);
  const [thumbnailMessage, setThumbnailMessage] = useState('');
  const [envIntensity, setEnvIntensity] = useState(1.6);
  const [hdrPath, setHdrPath] = useState(() => localStorage.getItem('assetLibrarian.hdrPath') || '');
  const [info, setInfo] = useState({ vertices: 0, faces: 0, materials: 0 });
  const [textureMap, setTextureMap] = useState({});

  const applyMaterialEnvironment = useCallback((object) => {
    object?.traverse((child) => {
      if (!child.isMesh) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        if (!material) return;
        if ('envMapIntensity' in material) material.envMapIntensity = envIntensity;
        if ('metalness' in material && material.metalness > 0.4 && 'roughness' in material && material.roughness > 0.85) {
          material.roughness = 0.65;
        }
        material.needsUpdate = true;
      });
    });
  }, [envIntensity]);

  const applyEnvironment = useCallback((texture, showBackground = false) => {
    const scene = sceneRef.current;
    const renderer = rendererRef.current;
    if (!scene || !renderer || !texture) return;

    if (!pmremRef.current) pmremRef.current = new THREE.PMREMGenerator(renderer);
    const envMap = pmremRef.current.fromEquirectangular(texture).texture;

    if (environmentRef.current) environmentRef.current.dispose();
    environmentRef.current = envMap;

    scene.environment = envMap;
    scene.background = showBackground ? envMap : new THREE.Color(0x202436);
    texture.dispose?.();
    applyMaterialEnvironment(modelRef.current);
  }, [applyMaterialEnvironment]);

  const loadHdrEnvironment = useCallback(async (filePath) => {
    const ext = filePath?.split('.').pop()?.toLowerCase();
    const Loader = ext === 'exr' ? EXRLoader : RGBELoader;
    const loader = new Loader();
    const texture = await loader.loadAsync(toAssetUrl(filePath));
    texture.mapping = THREE.EquirectangularReflectionMapping;
    applyEnvironment(texture, false);
  }, [applyEnvironment]);

  const applyDefaultEnvironment = useCallback(() => {
    applyEnvironment(createStudioEnvironment(), false);
  }, [applyEnvironment]);

  const buildAutoPbrMaterial = useCallback(async (textures = []) => {
    const byType = firstTextureByType(textures);
    const manager = new THREE.LoadingManager();
    const textureLoader = new THREE.TextureLoader(manager);
    const loadTexture = async (mapType, colorSpace = THREE.NoColorSpace) => {
      const filePath = byType[mapType];
      if (!filePath) return null;
      try {
        const texture = await textureLoader.loadAsync(toAssetUrl(filePath));
        texture.colorSpace = colorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.needsUpdate = true;
        return texture;
      } catch (e) {
        console.warn(`Texture skipped (${mapType}):`, e);
        return null;
      }
    };

    const material = new THREE.MeshStandardMaterial({
      name: 'AutoPBR',
      color: 0xb8bec8,
      roughness: 0.65,
      metalness: 0.0,
      envMapIntensity: 1.0,
    });

    const [
      albedo,
      normal,
      roughness,
      metallic,
      ao,
      emission,
      opacity,
    ] = await Promise.all([
      loadTexture('albedo', THREE.SRGBColorSpace),
      loadTexture('normal'),
      loadTexture('roughness'),
      loadTexture('metallic'),
      loadTexture('ao'),
      loadTexture('emission', THREE.SRGBColorSpace),
      loadTexture('opacity'),
    ]);

    if (albedo) material.map = albedo;
    if (normal) material.normalMap = normal;
    if (roughness) {
      material.roughnessMap = roughness;
      material.roughness = 1.0;
    }
    if (metallic) {
      material.metalnessMap = metallic;
      material.metalness = 1.0;
    }
    if (ao) {
      material.aoMap = ao;
      material.aoMapIntensity = 1.0;
    }
    if (emission) {
      material.emissiveMap = emission;
      material.emissive = new THREE.Color(0xffffff);
      material.emissiveIntensity = 1.0;
    }
    if (opacity) {
      material.alphaMap = opacity;
      material.transparent = true;
      material.depthWrite = false;
    }

    material.needsUpdate = true;
    return material;
  }, []);

  const applyAutoPbrMaterials = useCallback(async (object, modelId) => {
    if (!object || !modelId) return [];
    let textures = [];
    try {
      const detail = await window.api.getModel(modelId);
      textures = detail?.textures || [];
    } catch (e) {
      console.warn('Model texture detail skipped:', e);
    }

    const autoMaterial = await buildAutoPbrMaterial(textures);
    const hasAoMap = Boolean(autoMaterial.aoMap);

    object.traverse((child) => {
      if (!child.isMesh) return;
      if (hasAoMap) ensureUv2(child.geometry);

      if (Array.isArray(child.material)) {
        child.material = child.material.map((material) => (
          shouldUseAutoMaterial(material) ? autoMaterial.clone() : material
        ));
      } else if (shouldUseAutoMaterial(child.material)) {
        child.material = autoMaterial.clone();
      }
    });
    return textures;
  }, [buildAutoPbrMaterial]);

  const clearInspectorHelpers = useCallback(() => {
    [inspectorHelperRef, wireHelperRef].forEach((ref) => {
      const group = ref.current;
      if (!group) return;
      group.parent?.remove(group);
      group.traverse?.((child) => {
        child.geometry?.dispose?.();
        child.material?.dispose?.();
      });
      ref.current = null;
    });
  }, []);

  const restoreOriginalPreview = useCallback((object) => {
    if (!object) return;
    object.traverse((child) => {
      if (!child.isMesh) return;
      if (child.userData.originalMaterial) {
        child.material = child.userData.originalMaterial;
      }
      if (child.userData.originalColorAttribute !== undefined) {
        if (child.userData.originalColorAttribute) {
          child.geometry.setAttribute('color', child.userData.originalColorAttribute);
        } else {
          child.geometry.deleteAttribute('color');
        }
        delete child.userData.originalColorAttribute;
      }
    });
  }, []);

  const applyMaterialSide = useCallback((object, settings) => {
    object?.traverse((child) => {
      if (!child.isMesh) return;
      asMaterialArray(child.material).forEach((material) => {
        if (!material) return;
        material.side = settings.singleSided ? THREE.FrontSide : THREE.DoubleSide;
        material.needsUpdate = true;
      });
    });
  }, []);

  const getCachedTexture = useCallback(async (filePath, colorSpace = THREE.NoColorSpace) => {
    if (!filePath) return null;
    const key = `${filePath}|${colorSpace}`;
    if (textureCacheRef.current.has(key)) return textureCacheRef.current.get(key);
    try {
      const texture = await new THREE.TextureLoader().loadAsync(toAssetUrl(filePath));
      texture.colorSpace = colorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.needsUpdate = true;
      textureCacheRef.current.set(key, texture);
      return texture;
    } catch (e) {
      console.warn('Inspector texture skipped:', e);
      return null;
    }
  }, []);

  const createChannelMaterial = useCallback(async (sourceMaterial, channel) => {
    const byType = textureMap || {};
    const makeBasic = (params) => new THREE.MeshBasicMaterial({ name: `Inspector-${channel}`, ...params });
    const source = sourceMaterial || {};

    if (channel === 'baseColor') {
      const texture = source.map || await getCachedTexture(byType.albedo, THREE.SRGBColorSpace);
      return makeBasic({ map: texture || null, color: texture ? 0xffffff : (source.color || new THREE.Color(0xb8bec8)) });
    }
    if (channel === 'metalness') {
      const texture = source.metalnessMap || await getCachedTexture(byType.metallic);
      return makeBasic({ map: texture || null, color: texture ? 0xffffff : new THREE.Color(source.metalness ?? 0.0, source.metalness ?? 0.0, source.metalness ?? 0.0) });
    }
    if (channel === 'roughness') {
      const texture = source.roughnessMap || await getCachedTexture(byType.roughness);
      return makeBasic({ map: texture || null, color: texture ? 0xffffff : new THREE.Color(source.roughness ?? 0.65, source.roughness ?? 0.65, source.roughness ?? 0.65) });
    }
    if (channel === 'normal') {
      const texture = source.normalMap || await getCachedTexture(byType.normal);
      return makeBasic({ map: texture || createSolidTexture(0x8080ff), color: 0xffffff });
    }
    if (channel === 'ao') {
      const texture = source.aoMap || await getCachedTexture(byType.ao);
      return makeBasic({ map: texture || null, color: texture ? 0xffffff : 0xb6b6b6 });
    }
    if (channel === 'opacity') {
      const texture = source.alphaMap || await getCachedTexture(byType.opacity);
      return makeBasic({ map: texture || null, color: texture ? 0xffffff : new THREE.Color(source.opacity ?? 1, source.opacity ?? 1, source.opacity ?? 1) });
    }
    if (channel === 'emission') {
      const texture = source.emissiveMap || await getCachedTexture(byType.emission, THREE.SRGBColorSpace);
      return makeBasic({ map: texture || null, color: texture ? 0xffffff : (source.emissive || 0x000000) });
    }
    if (channel === 'specularF0') {
      return makeBasic({ color: source.specularColor || 0x707070 });
    }
    if (channel === 'clearCoat') {
      const value = source.clearcoat ?? source.clearCoat ?? 0;
      return makeBasic({ color: new THREE.Color(value, value, value) });
    }
    if (channel === 'clearCoatRoughness') {
      const value = source.clearcoatRoughness ?? source.clearCoatRoughness ?? 0.5;
      return makeBasic({ color: new THREE.Color(value, value, value) });
    }
    return null;
  }, [getCachedTexture, textureMap]);

  const applyChannelPreview = useCallback(async (object, channel) => {
    if (!object || channel === 'final') return;
    const tasks = [];
    object.traverse((child) => {
      if (!child.isMesh) return;
      const originals = asMaterialArray(child.userData.originalMaterial || child.material);
      if (Array.isArray(child.userData.originalMaterial || child.material)) {
        tasks.push(Promise.all(originals.map((mat) => createChannelMaterial(mat, channel))).then((materials) => {
          child.material = materials.filter(Boolean);
        }));
      } else {
        tasks.push(createChannelMaterial(firstMaterial(child.userData.originalMaterial || child.material), channel).then((material) => {
          if (material) child.material = material;
        }));
      }
    });
    await Promise.all(tasks);
  }, [createChannelMaterial]);

  const applyGeometryPreview = useCallback((object, mode) => {
    if (!object || mode === 'none') return;
    if (mode === 'vertexNormals') {
      const group = new THREE.Group();
      object.traverse((child) => {
        if (child.isMesh && child.geometry?.attributes?.normal) {
          group.add(new VertexNormalsHelper(child, 0.08, 0x36d6ff));
        }
      });
      sceneRef.current?.add(group);
      inspectorHelperRef.current = group;
      return;
    }

    const checker = uvCheckerRef.current || createUvCheckerTexture();
    uvCheckerRef.current = checker;
    const matcap = matcapRef.current || createMatcapTexture();
    matcapRef.current = matcap;

    object.traverse((child) => {
      if (!child.isMesh) return;
      const source = firstMaterial(child.userData.originalMaterial || child.material);
      if (mode === 'wireframe') {
        child.material = new THREE.MeshBasicMaterial({
          color: inspectorSettings.wireframe?.color || '#ffffff',
          wireframe: true,
          transparent: true,
          opacity: inspectorSettings.wireframe?.opacity ?? 0.55,
        });
      } else if (mode === 'uvChecker') {
        child.material = new THREE.MeshBasicMaterial({ map: checker, color: 0xffffff });
      } else if (mode === 'matcap') {
        child.material = new THREE.MeshMatcapMaterial({ matcap, color: 0xffffff });
      } else if (mode === 'matcapSurface') {
        child.material = new THREE.MeshMatcapMaterial({
          matcap,
          color: source?.color || new THREE.Color(0xb8bec8),
        });
      }
    });
  }, [inspectorSettings.wireframe?.color, inspectorSettings.wireframe?.opacity]);

  const applyWireOverlay = useCallback((object, settings) => {
    if (!object || !settings.wireframe?.enabled || settings.geometryMode === 'wireframe') return;
    const group = new THREE.Group();
    const color = new THREE.Color(settings.wireframe.color || '#ffffff');
    object.traverse((child) => {
      if (!child.isMesh || !child.geometry) return;
      const wire = new THREE.LineSegments(
        new THREE.WireframeGeometry(child.geometry),
        new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: settings.wireframe.opacity ?? 0.55,
          depthTest: true,
        })
      );
      wire.matrix.copy(child.matrixWorld);
      wire.matrixAutoUpdate = false;
      group.add(wire);
    });
    sceneRef.current?.add(group);
    wireHelperRef.current = group;
  }, []);

  const applySkeletonHelpers = useCallback((object, settings) => {
    if (!object || (!settings.bones && !settings.boneInfluence)) return;
    const group = new THREE.Group();
    if (settings.bones) {
      object.traverse((child) => {
        if (child.isSkinnedMesh) group.add(new THREE.SkeletonHelper(child));
      });
    }
    if (settings.boneInfluence) {
      object.traverse((child) => {
        const weights = child.isSkinnedMesh ? child.geometry?.attributes?.skinWeight : null;
        if (!weights || !child.geometry?.attributes?.position) return;
        if (child.userData.originalColorAttribute === undefined) {
          child.userData.originalColorAttribute = child.geometry.getAttribute('color') || null;
        }
        const colors = [];
        const color = new THREE.Color();
        for (let i = 0; i < weights.count; i++) {
          const strength = Math.max(weights.getX(i), weights.getY(i), weights.getZ(i), weights.getW(i));
          color.setHSL((1 - strength) * 0.66, 1, 0.5);
          colors.push(color.r, color.g, color.b);
        }
        child.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        child.material = new THREE.MeshBasicMaterial({ vertexColors: true });
      });
    }
    if (group.children.length > 0) {
      sceneRef.current?.add(group);
      inspectorHelperRef.current = group;
    }
  }, []);

  const applyInspectorSettings = useCallback(async () => {
    const object = modelRef.current;
    const renderer = rendererRef.current;
    if (!object || !renderer) return;
    const settings = { ...DEFAULT_INSPECTOR_SETTINGS, ...inspectorSettings };

    clearInspectorHelpers();
    restoreOriginalPreview(object);
    renderer.toneMapping = settings.renderMode === 'noPost' ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = settings.renderMode === 'noPost' ? 1.0 : 1.28;

    if (settings.materialChannel && settings.materialChannel !== 'final') {
      await applyChannelPreview(object, settings.materialChannel);
    } else {
      applyGeometryPreview(object, settings.geometryMode || 'none');
    }

    applySkeletonHelpers(object, settings);
    applyWireOverlay(object, settings);
    applyMaterialSide(object, settings);
    applyMaterialEnvironment(object);
  }, [
    applyChannelPreview,
    applyGeometryPreview,
    applyMaterialEnvironment,
    applyMaterialSide,
    applySkeletonHelpers,
    applyWireOverlay,
    clearInspectorHelpers,
    inspectorSettings,
    restoreOriginalPreview,
  ]);

  const stopAnimations = useCallback(() => {
    animationActionsRef.current.forEach((action) => action.stop());
    animationActionsRef.current = [];
    mixerRef.current?.stopAllAction();
    mixerRef.current = null;
  }, []);

  const playAnimations = useCallback((object, animations, mode) => {
    stopAnimations();
    if (!object || !animations?.length || mode === 'off') return;

    const mixer = new THREE.AnimationMixer(object);
    const loopOnce = mode === 'once';
    const actions = animations.map((clip) => {
      const action = mixer.clipAction(clip);
      action.reset();
      action.clampWhenFinished = loopOnce;
      action.setLoop(loopOnce ? THREE.LoopOnce : THREE.LoopRepeat, loopOnce ? 1 : Infinity);
      action.play();
      return action;
    });

    mixerRef.current = mixer;
    animationActionsRef.current = actions;
  }, [stopAnimations]);

  const gatherModelState = useCallback((object) => {
    const capabilities = {
      hasBones: false,
      hasSkinWeights: false,
      hasNormals: false,
      hasUv: false,
      hasSpecular: false,
      hasClearCoat: false,
    };
    let verts = 0;
    let faces = 0;
    const materialsSet = new Set();

    object?.traverse((child) => {
      if (!child.isMesh) return;
      child.userData.originalMaterial = child.material;
      capabilities.hasBones = capabilities.hasBones || Boolean(child.isSkinnedMesh);
      capabilities.hasSkinWeights = capabilities.hasSkinWeights || Boolean(child.geometry?.attributes?.skinWeight);
      capabilities.hasNormals = capabilities.hasNormals || Boolean(child.geometry?.attributes?.normal);
      capabilities.hasUv = capabilities.hasUv || Boolean(child.geometry?.attributes?.uv);
      asMaterialArray(child.material).forEach((material) => {
        materialsSet.add(material?.name || 'Material');
        capabilities.hasSpecular = capabilities.hasSpecular || Boolean(material?.specularColor || material?.specularIntensityMap);
        capabilities.hasClearCoat = capabilities.hasClearCoat || (
          'clearcoat' in (material || {}) ||
          'clearCoat' in (material || {}) ||
          Boolean(material?.clearcoatMap || material?.clearcoatRoughnessMap)
        );
      });

      if (child.geometry) {
        const pos = child.geometry.getAttribute('position');
        if (pos) verts += pos.count;
        const idx = child.geometry.index;
        if (idx) faces += idx.count / 3;
      }
    });

    return {
      capabilities,
      info: { vertices: verts, faces: Math.floor(faces), materials: materialsSet.size },
    };
  }, []);

  // ── Init Three.js scene ──
  const initScene = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const w = container.clientWidth;
    const h = container.clientHeight;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);
    sceneRef.current = scene;
    setSceneReady(true);

    // Camera
    const camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 1000);
    camera.position.set(3, 2, 5);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.28;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 2.0;
    controls.target.set(0, 0, 0);
    controlsRef.current = controls;

    // Lighting
    scene.add(new THREE.HemisphereLight(0xeaf2ff, 0x8890a2, 1.25));

    const mainLight = new THREE.DirectionalLight(0xfff3df, 3.2);
    mainLight.position.set(5, 8, 6);
    mainLight.castShadow = true;
    scene.add(mainLight);

    const fillLight = new THREE.DirectionalLight(0x8fb7ff, 1.4);
    fillLight.position.set(-4, 3, -5);
    scene.add(fillLight);

    scene.add(new THREE.DirectionalLight(0xffffff, 1.1).position.set(-2, -1, 8));

    // Ground
    const gridHelper = new THREE.GridHelper(10, 20, 0x444488, 0x333366);
    gridHelper.position.y = -1;
    scene.add(gridHelper);

    const groundGeo = new THREE.PlaneGeometry(20, 20);
    const groundMat = new THREE.ShadowMaterial({ opacity: 0.4 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.99;
    ground.receiveShadow = true;
    scene.add(ground);

    const clock = new THREE.Clock();

    // Animate
    const animate = () => {
      animRef.current = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      mixerRef.current?.update(delta);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Resize
    const onResize = () => {
      const w2 = container.clientWidth;
      const h2 = container.clientHeight;
      if (!w2 || !h2) return;
      camera.aspect = w2 / h2;
      camera.updateProjectionMatrix();
      renderer.setSize(w2, h2);
    };
    window.addEventListener('resize', onResize);
    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(container);

    return () => {
      window.removeEventListener('resize', onResize);
      resizeObserver.disconnect();
      if (animRef.current) cancelAnimationFrame(animRef.current);
      stopAnimations();
      if (environmentRef.current) environmentRef.current.dispose();
      if (pmremRef.current) pmremRef.current.dispose();
      clearInspectorHelpers();
      renderer.dispose();
      container.removeChild(renderer.domElement);
      sceneRef.current = null;
      rendererRef.current = null;
      setSceneReady(false);
    };
  }, [clearInspectorHelpers]);

  // ── Load model ──
  const loadModel = useCallback(async (filePath, modelId) => {
    const scene = sceneRef.current;
    if (!scene) {
      setLoading(false);
      return;
    }
    const loadToken = loadTokenRef.current + 1;
    loadTokenRef.current = loadToken;
    const loadingTimeout = setTimeout(() => {
      if (loadTokenRef.current !== loadToken) return;
      setLoading(false);
      setError('Preview loading timed out. The model file or one of its external resources may be unavailable.');
    }, 20000);

    // Clear old model
    if (modelRef.current) {
      clearInspectorHelpers();
      restoreOriginalPreview(modelRef.current);
      stopAnimations();
      scene.remove(modelRef.current);
      modelRef.current.traverse?.((child) => {
        child.geometry?.dispose?.();
        asMaterialArray(child.material).forEach((material) => {
          if (material && material.name?.startsWith?.('Inspector-')) material.dispose?.();
        });
      });
      modelRef.current = null;
    }
    setTextureMap({});
    animationsRef.current = [];
    setHasAnimations(false);
    setAnimationMode('auto');
    onCapabilitiesChange?.({});

    setLoading(true);
    setError(null);

    const ext = filePath?.split('.').pop()?.toLowerCase();
    const modelDir = filePath?.substring(0, filePath.lastIndexOf('/') > 0
      ? filePath.lastIndexOf('/')
      : filePath.lastIndexOf('\\'));
    const modelUrl = toAssetUrl(filePath);
    const baseName = filePath?.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, '');
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => toAssetUrl(resolveSiblingPath(modelDir, url)));

    try {
      let object;
      let loadedAnimations = [];

      if (ext === 'glb' || ext === 'gltf') {
        const loader = new GLTFLoader(manager);
        const dracoLoader = new DRACOLoader(manager);
        dracoLoader.setDecoderPath('./node_modules/three/examples/jsm/libs/draco/');
        loader.setDRACOLoader(dracoLoader);
        const gltf = await withTimeout(loader.loadAsync(modelUrl), 'Model loading');
        object = gltf.scene;
        loadedAnimations = gltf.animations || [];
      } else if (ext === 'obj') {
        const loader = new OBJLoader(manager);
        // Try to load MTL
        const mtlPath = filePath.replace(/\.obj$/i, '.mtl');
        const response = await fetch(toAssetUrl(mtlPath));
        if (response.ok) {
          const mtlLoader = new MTLLoader(manager);
          const materials = await withTimeout(mtlLoader.loadAsync(toAssetUrl(mtlPath)), 'Material loading', 15000);
          materials.preload();
          loader.setMaterials(materials);
        }
        object = await withTimeout(loader.loadAsync(modelUrl), 'Model loading');
        loadedAnimations = object.animations || [];
      } else if (ext === 'fbx') {
        const loader = new FBXLoader(manager);
        object = await withTimeout(loader.loadAsync(modelUrl), 'Model loading');
        loadedAnimations = object.animations || [];
      } else if (ext === 'usdz') {
        const loader = new USDLoader(manager);
        object = await withTimeout(loader.loadAsync(modelUrl), 'Model loading');
        loadedAnimations = object.animations || [];
      } else {
        throw new Error(`Unsupported format: ${ext}`);
      }

      // Configure
      object.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      scene.add(object);
      modelRef.current = object;
      animationsRef.current = loadedAnimations;
      setHasAnimations(loadedAnimations.length > 0);
      if (loadedAnimations.length > 0) {
        playAnimations(object, loadedAnimations, 'auto');
      }
      applyMaterialSide(object, { singleSided: false });
      applyMaterialEnvironment(object);

      // Fit camera
      const box = new THREE.Box3().setFromObject(object);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z, 0.0001);
      const dist = maxDim * 1.8;

      controlsRef.current.target.copy(center);
      cameraRef.current.near = Math.max(maxDim / 1000, 0.000001);
      cameraRef.current.far = Math.max(maxDim * 1000, 1000);
      cameraRef.current.position.set(dist * 0.6, dist * 0.4, dist);
      cameraRef.current.updateProjectionMatrix();
      controlsRef.current.update();

      const initialState = gatherModelState(object);
      setInfo(initialState.info);
      onCapabilitiesChange?.(initialState.capabilities);
      clearTimeout(loadingTimeout);
      setLoading(false);

      applyAutoPbrMaterials(object, modelId)
        .then((textures) => {
          if (modelRef.current !== object) return;
          setTextureMap(firstTextureByType(textures));
          applyMaterialEnvironment(object);
          const enhancedState = gatherModelState(object);
          setInfo(enhancedState.info);
          onCapabilitiesChange?.(enhancedState.capabilities);
        })
        .catch((e) => {
          console.warn('Auto PBR skipped:', e);
        });
      return;

    } catch (e) {
      clearTimeout(loadingTimeout);
      setError(e.message || 'Failed to load model');
      onCapabilitiesChange?.({});
    }
    setLoading(false);
  }, [
    applyAutoPbrMaterials,
    applyMaterialEnvironment,
    applyMaterialSide,
    clearInspectorHelpers,
    gatherModelState,
    onCapabilitiesChange,
    playAnimations,
    restoreOriginalPreview,
    stopAnimations,
  ]);

  // ── Mount ──
  useEffect(() => {
    const cleanup = initScene();
    return cleanup;
  }, [initScene]);

  useEffect(() => {
    if (!sceneRef.current || !rendererRef.current) return;
    if (hdrPath) {
      loadHdrEnvironment(hdrPath).catch((e) => {
        setError(`HDR environment failed: ${e.message}`);
        applyDefaultEnvironment();
      });
    } else {
      applyDefaultEnvironment();
    }
  }, [hdrPath, loadHdrEnvironment, applyDefaultEnvironment]);

  useEffect(() => {
    applyMaterialEnvironment(modelRef.current);
  }, [envIntensity, applyMaterialEnvironment]);

  useEffect(() => {
    applyInspectorSettings();
  }, [applyInspectorSettings, model?.id, textureMap]);

  // ── Load model when selected ──
  useEffect(() => {
    if (model?.file_path && sceneReady) {
      loadModel(model.file_path, model.id);
    }
  }, [model?.id, model?.file_path, sceneReady, loadModel]);

  // ── Auto-rotate sync ──
  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.autoRotate = autoRotate;
    }
  }, [autoRotate]);

  const handleAnimationMode = useCallback((mode) => {
    setAnimationMode(mode);
    playAnimations(modelRef.current, animationsRef.current, mode);
  }, [playAnimations]);

  const handleSavePreviewThumbnail = useCallback(async () => {
    const renderer = rendererRef.current;
    if (!renderer || !model?.file_path) return;
    try {
      const dataUrl = renderer.domElement.toDataURL('image/png');
      const result = await window.api.savePreviewThumbnail(model.file_path, dataUrl);
      if (!result?.ok) {
        setThumbnailMessage(result?.error || 'Thumbnail save failed');
        return;
      }
      setThumbnailMessage('Thumbnail saved');
      onThumbnailSaved?.(result.path);
      setTimeout(() => setThumbnailMessage(''), 1800);
    } catch (e) {
      setThumbnailMessage(e.message || 'Thumbnail save failed');
    }
  }, [model?.file_path, onThumbnailSaved]);

  const handleChooseHdr = useCallback(async () => {
    try {
      const selected = await window.api.showOpenHdrDialog();
      if (!selected) return;
      localStorage.setItem('assetLibrarian.hdrPath', selected);
      setHdrPath(selected);
    } catch (e) {
      setError(`HDR selection failed: ${e.message}`);
    }
  }, []);

  const handleResetHdr = useCallback(() => {
    localStorage.removeItem('assetLibrarian.hdrPath');
    setHdrPath('');
  }, []);

  const currentInspector = { ...DEFAULT_INSPECTOR_SETTINGS, ...inspectorSettings };
  const channelTextureTypes = {
    final: 'albedo',
    baseColor: 'albedo',
    metalness: 'metallic',
    roughness: 'roughness',
    normal: 'normal',
    ao: 'ao',
    opacity: 'opacity',
    emission: 'emission',
  };
  const twoDType = currentInspector.geometryMode === 'uvChecker'
    ? 'uvChecker'
    : channelTextureTypes[currentInspector.materialChannel] || 'albedo';
  const twoDPath = twoDType === 'uvChecker' ? null : textureMap[twoDType];
  const show2D = currentInspector.viewport === 'split' || currentInspector.viewport === '2d';

  return (
    <div className={`model-viewer viewport-${currentInspector.viewport}`}>
      {/* Toolbar */}
      <div className="viewer-toolbar">
        <div className="viewer-title">
          {model?.file_name || '3D Preview'}
        </div>
        <div className="viewer-actions">
          <button
            className={`btn btn-sm ${autoRotate ? 'active' : ''}`}
            onClick={() => setAutoRotate(!autoRotate)}
            title="Toggle auto-rotate"
          >
            {autoRotate ? '⏸' : '🔄'} Auto
          </button>
          <div className={`viewer-animation-control ${hasAnimations ? '' : 'disabled'}`} title={hasAnimations ? 'Animation playback' : 'No animation clips found'}>
            {[
              ['auto', 'Auto'],
              ['once', 'Once'],
              ['off', 'Off'],
            ].map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className={animationMode === mode ? 'active' : ''}
                disabled={!hasAnimations}
                onClick={() => handleAnimationMode(mode)}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="viewer-env-control" title="Environment intensity">
            HDR
            <input
              type="range"
              min="0"
              max="3"
              step="0.1"
              value={envIntensity}
              onChange={(e) => setEnvIntensity(Number(e.target.value))}
            />
          </label>
          <button className="btn btn-sm" onClick={handleChooseHdr} title={hdrPath || 'Choose HDR environment'}>
            HDR File
          </button>
          <button className="btn btn-sm" onClick={handleSavePreviewThumbnail} title="Use current preview as thumbnail">
            Thumb
          </button>
          {hdrPath && (
            <button className="btn btn-sm" onClick={handleResetHdr} title="Use default studio environment">
              Default
            </button>
          )}
          <button className="btn btn-sm" onClick={onToggleFullscreen} title={isFullscreen ? 'Exit full screen detail view' : 'Full screen detail view'}>
            {isFullscreen ? 'Exit' : 'Full'}
          </button>
          <button className="btn btn-sm" onClick={onClose} title="Close viewer">
            ✕ Close
          </button>
        </div>
      </div>

      <div className="viewer-content">
        {/* Viewer canvas */}
        <div className="viewer-canvas" ref={containerRef}>
          {loading && (
            <div className="viewer-overlay">
              <div className="spinner" />
              <span>Loading model…</span>
            </div>
          )}
          {error && (
            <div className="viewer-overlay error">
              <span>❌ {error}</span>
            </div>
          )}
        </div>

        {show2D && (
          <div className="viewer-2d-panel">
            <div className="viewer-2d-title">{twoDType === 'uvChecker' ? 'UV Checker' : twoDType}</div>
            {twoDType === 'uvChecker' ? (
              <div className="uv-checker-preview" />
            ) : twoDPath ? (
              <img src={toAssetUrl(twoDPath)} alt={twoDType} />
            ) : (
              <div className="viewer-2d-empty">No texture for this channel</div>
            )}
          </div>
        )}
        {thumbnailMessage && (
          <div className="viewer-toast">{thumbnailMessage}</div>
        )}
      </div>

      {/* Model info bar */}
      <div className="viewer-info">
        <span>📍 {info.vertices.toLocaleString()} vertices</span>
        <span>🔺 {info.faces.toLocaleString()} faces</span>
        <span>🎨 {info.materials} materials</span>
      </div>
    </div>
  );
}
