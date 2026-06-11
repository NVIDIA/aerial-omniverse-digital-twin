/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from "react";
import {
  DEFAULT_BASE_LAYER_ID,
  getBaseLayerById,
  getCesiumIonToken,
  type BaseLayerConfig,
} from "@/constants/baseLayers";
import { loadBaseLayerId } from "@/store/utils/localStorage";
import { useViewerStore } from "@/store/viewerStore";
import {
  createMinioProxyResource,
  readMinioProxySettingsFromStorage,
  shouldProxyTileUrlToMinio,
} from "@/utils/minioProxyResource";

interface CesiumViewerOptions {
  isClient: boolean;
  containerRef: { current: HTMLDivElement | null };
  onViewerReady: (viewer: any) => void;
  onError: (error: string) => void;
}

/**
 * Creates a Cesium imagery provider from a base layer config
 */
const createImageryProvider = (Cesium: any, config: BaseLayerConfig): any => {
  switch (config.type) {
    case "wmts":
      return new Cesium.WebMapTileServiceImageryProvider({
        url: config.url,
        layer: config.layer,
        style: config.style,
        format: config.format,
        tileMatrixSetID: config.tileMatrixSetID,
        credit: config.credit,
        maximumLevel: config.maximumLevel,
      });

    case "url":
      return new Cesium.UrlTemplateImageryProvider({
        url: config.url,
        subdomains: config.subdomains,
        credit: config.credit,
        maximumLevel: config.maximumLevel,
      });

    case "osm":
      return new Cesium.OpenStreetMapImageryProvider({
        url: config.url,
        credit: config.credit,
        maximumLevel: config.maximumLevel,
      });

    case "ion":
      return Cesium.IonImageryProvider.fromAssetId(config.ionAssetId);

    default:
      // Fallback to default Sentinel-2
      const defaultConfig = getBaseLayerById(DEFAULT_BASE_LAYER_ID)!;
      return new Cesium.WebMapTileServiceImageryProvider({
        url: defaultConfig.url,
        layer: defaultConfig.layer,
        style: defaultConfig.style,
        format: defaultConfig.format,
        tileMatrixSetID: defaultConfig.tileMatrixSetID,
        credit: defaultConfig.credit,
        maximumLevel: defaultConfig.maximumLevel,
      });
  }
};

/**
 * Changes the base layer of the viewer
 */
export const changeBaseLayer = async (
  viewer: any,
  layerId: string,
): Promise<void> => {
  if (!viewer || viewer.isDestroyed()) return;

  const Cesium = window.Cesium;
  if (!Cesium) return;

  const config = getBaseLayerById(layerId);
  if (!config) {
    console.warn(`[CesiumViewer] Base layer not found: ${layerId}`);
    return;
  }

  try {
    const layers = viewer.imageryLayers;

    // Remove the current base layer (always at index 0)
    if (layers.length > 0) {
      layers.remove(layers.get(0), true);
    }

    const provider = await Promise.resolve(
      createImageryProvider(Cesium, config),
    );
    if (viewer.isDestroyed()) return;
    layers.addImageryProvider(provider, 0);
  } catch (error) {
    console.error("[CesiumViewer] Failed to change base layer:", error);
  }
};

// Global singleton to prevent multiple viewer instances in StrictMode
let globalViewerInstance: any = null;
let globalViewerPromise: Promise<any> | null = null;

export function resolveMinioResourceForCesium(
  Cesium: any,
  url: string,
): string | unknown {
  const settings = readMinioProxySettingsFromStorage();
  if (settings && shouldProxyTileUrlToMinio(url, settings)) {
    return createMinioProxyResource(
      Cesium,
      url,
      settings.accessKey,
      settings.secretKey,
      settings.s3Endpoint,
    );
  }
  return url;
}

// Use ellipsoid above this altitude, high-detail terrain below.
const ELLIPSOID_TERRAIN_THRESHOLD_METERS = 50_000;
const ELLIPSOID_TERRAIN_HYSTERESIS_METERS = 100;

// Black-overlay swap timings (same in both directions).
const TERRAIN_TRANSITION_FADE_IN_MS = 50;
const TERRAIN_TRANSITION_FADE_OUT_MS = 220;
const TERRAIN_SWAP_ELLIPSOID_MIN_HOLD_MS = 120;
const TERRAIN_SWAP_ELLIPSOID_MAX_HOLD_MS = 250;
const TERRAIN_SWAP_HIGH_DETAIL_MIN_HOLD_MS = 120;
const TERRAIN_SWAP_HIGH_DETAIL_MAX_HOLD_MS = 250;

// Module-scoped so provider identities stay stable across subscription rebuilds.
let sharedEllipsoidProvider: any = null;
const sharedHighDetailTerrainCache: Map<
  string,
  { provider: any; promise: Promise<any> | null }
> = new Map();

const getSharedEllipsoidProvider = (Cesium: any): any => {
  if (!sharedEllipsoidProvider) {
    sharedEllipsoidProvider = new Cesium.EllipsoidTerrainProvider();
  }
  return sharedEllipsoidProvider;
};

// Per-viewer black overlay used to mask terrain swaps.
const transitionOverlays: WeakMap<any, HTMLDivElement> = new WeakMap();

const getOrCreateTransitionOverlay = (viewer: any): HTMLDivElement | null => {
  const existing = transitionOverlays.get(viewer);
  if (existing && existing.isConnected) return existing;

  try {
    const canvas = viewer?.canvas as HTMLCanvasElement | undefined;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return null;

    const overlay = document.createElement("div");
    overlay.dataset.role = "cesium-terrain-transition";
    overlay.style.position = "absolute";
    overlay.style.inset = "0";
    overlay.style.backgroundColor = "black";
    overlay.style.opacity = "0";
    overlay.style.pointerEvents = "none";
    overlay.style.zIndex = "9999";
    overlay.style.willChange = "opacity";

    if (getComputedStyle(parent).position === "static") {
      parent.style.position = "relative";
    }

    parent.appendChild(overlay);
    transitionOverlays.set(viewer, overlay);
    return overlay;
  } catch {
    return null;
  }
};

const fadeOverlayTo = (
  overlay: HTMLDivElement,
  targetOpacity: number,
  durationMs: number,
): Promise<void> =>
  new Promise((resolve) => {
    let resolved = false;
    let safetyTimeoutId: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      overlay.removeEventListener("transitionend", onEnd);
      if (safetyTimeoutId != null) clearTimeout(safetyTimeoutId);
      resolve();
    };
    const onEnd = (e: TransitionEvent) => {
      if (e.propertyName !== "opacity") return;
      finish();
    };

    overlay.addEventListener("transitionend", onEnd);
    overlay.style.transition = `opacity ${durationMs}ms ease-in-out`;
    void overlay.offsetWidth; // force reflow for chained fades

    if (parseFloat(overlay.style.opacity || "0") === targetOpacity) {
      finish();
      return;
    }

    overlay.style.opacity = String(targetOpacity);
    safetyTimeoutId = setTimeout(finish, durationMs + 80);
  });

const getOrLoadSharedHighDetailTerrain = (
  Cesium: any,
  terrainUrl: string,
): Promise<any> => {
  const cached = sharedHighDetailTerrainCache.get(terrainUrl);
  if (cached?.provider) return Promise.resolve(cached.provider);
  if (cached?.promise) return cached.promise;

  const promise = (async () => {
    try {
      const provider = await Cesium.CesiumTerrainProvider.fromUrl(
        resolveMinioResourceForCesium(Cesium, terrainUrl),
        {
          requestVertexNormals: false,
          requestWaterMask: false,
        },
      );
      sharedHighDetailTerrainCache.set(terrainUrl, { provider, promise: null });
      return provider;
    } catch {
      // Don't poison the cache: clear the in-flight entry so future calls
      // can retry fromUrl() if the server recovers.
      sharedHighDetailTerrainCache.delete(terrainUrl);
      return getSharedEllipsoidProvider(Cesium);
    }
  })();
  sharedHighDetailTerrainCache.set(terrainUrl, { provider: null, promise });
  return promise;
};

let vizTerrainUnsubscribe: (() => void) | null = null;
function setupVizTerrainSubscription(viewer: any, Cesium: any): void {
  if (vizTerrainUnsubscribe) {
    vizTerrainUnsubscribe();
    vizTerrainUnsubscribe = null;
  }
  let prevVizBase = useViewerStore.getState().vizBaseUrl;
  let requestId = 0;

  let lastAltitudeState: "above" | "below" | null = null;

  const getCameraHeight = (): number => {
    try {
      return viewer.camera.positionCartographic?.height ?? 0;
    } catch {
      return 0;
    }
  };

  const computeAltitudeState = (height: number): "above" | "below" => {
    if (lastAltitudeState === "above") {
      return height <
        ELLIPSOID_TERRAIN_THRESHOLD_METERS - ELLIPSOID_TERRAIN_HYSTERESIS_METERS
        ? "below"
        : "above";
    }
    if (lastAltitudeState === "below") {
      return height >
        ELLIPSOID_TERRAIN_THRESHOLD_METERS + ELLIPSOID_TERRAIN_HYSTERESIS_METERS
        ? "above"
        : "below";
    }
    return height > ELLIPSOID_TERRAIN_THRESHOLD_METERS ? "above" : "below";
  };

  // Overlay only fades back out when this hits 0, so rapid swaps don't flicker.
  let activeSwapCount = 0;

  // High-detail mode requires queueLength to have been non-zero at least once;
  // Cesium can transiently report 0 before it's started requesting new tiles.
  const waitForGlobeReady = (
    mode: "ellipsoid" | "high-detail",
  ): Promise<void> => {
    const minHoldMs =
      mode === "ellipsoid"
        ? TERRAIN_SWAP_ELLIPSOID_MIN_HOLD_MS
        : TERRAIN_SWAP_HIGH_DETAIL_MIN_HOLD_MS;
    const maxHoldMs =
      mode === "ellipsoid"
        ? TERRAIN_SWAP_ELLIPSOID_MAX_HOLD_MS
        : TERRAIN_SWAP_HIGH_DETAIL_MAX_HOLD_MS;
    const requireLoadObserved = mode === "high-detail";

    return new Promise((resolve) => {
      const startTime =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      let settled = false;
      let sawLoading = false;

      const now = () =>
        typeof performance !== "undefined" ? performance.now() : Date.now();

      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      const tick = () => {
        if (settled) return;
        const elapsed = now() - startTime;

        let isLoading = true;
        try {
          isLoading = !viewer.scene.globe.tilesLoaded;
        } catch {
          return finish();
        }

        if (isLoading) sawLoading = true;

        if (elapsed >= maxHoldMs) return finish();
        if (
          elapsed >= minHoldMs &&
          !isLoading &&
          (!requireLoadObserved || sawLoading)
        ) {
          return finish();
        }

        if (typeof requestAnimationFrame !== "undefined") {
          requestAnimationFrame(tick);
        } else {
          setTimeout(tick, 16);
        }
      };

      // Force a render so Cesium queues tiles for the new provider.
      try {
        viewer.scene.requestRender();
      } catch {
        // ignore
      }

      if (typeof requestAnimationFrame !== "undefined") {
        requestAnimationFrame(tick);
      } else {
        setTimeout(tick, 16);
      }
    });
  };

  const applyTerrain = async (id: number) => {
    if (!viewer || viewer.isDestroyed()) return;

    const vizBaseUrl = useViewerStore.getState().vizBaseUrl;
    const terrainUrl = vizBaseUrl ? `${vizBaseUrl}terrain/` : null;
    let altitudeState = computeAltitudeState(getCameraHeight());

    let targetProvider: any;
    if (!terrainUrl || altitudeState === "above") {
      targetProvider = getSharedEllipsoidProvider(Cesium);
    } else {
      targetProvider = await getOrLoadSharedHighDetailTerrain(
        Cesium,
        terrainUrl,
      );
    }

    if (id !== requestId) return;
    if (!viewer || viewer.isDestroyed()) return;

    // Don't latch "below" when high-detail load failed and we got the
    // ellipsoid fallback — that would block onCameraChanged from ever
    // retrying. null lets the next camera move re-evaluate.
    const settledAltitudeState =
      altitudeState === "below" &&
      targetProvider === getSharedEllipsoidProvider(Cesium)
        ? null
        : altitudeState;

    if (viewer.terrainProvider === targetProvider) {
      lastAltitudeState = settledAltitudeState;
      return;
    }

    activeSwapCount++;

    const overlay = getOrCreateTransitionOverlay(viewer);

    // Fade in -> swap -> wait for tiles -> fade out.
    if (overlay) {
      await fadeOverlayTo(overlay, 1, TERRAIN_TRANSITION_FADE_IN_MS);
    }

    // Camera may have crossed back during the fade-in; onCameraChanged
    // can't catch that because lastAltitudeState isn't updated until we
    // commit. Recompute and re-resolve the provider before swapping.
    const currentAltitudeState = computeAltitudeState(getCameraHeight());
    if (currentAltitudeState !== altitudeState) {
      altitudeState = currentAltitudeState;
      if (!terrainUrl || altitudeState === "above") {
        targetProvider = getSharedEllipsoidProvider(Cesium);
      } else {
        targetProvider = await getOrLoadSharedHighDetailTerrain(
          Cesium,
          terrainUrl,
        );
      }
    }

    const swapMode: "ellipsoid" | "high-detail" =
      targetProvider === getSharedEllipsoidProvider(Cesium)
        ? "ellipsoid"
        : "high-detail";

    if (id === requestId && viewer && !viewer.isDestroyed()) {
      viewer.terrainProvider = targetProvider;
      // Same fallback-detection rule as above: don't latch "below" when we
      // ended up with the ellipsoid because high-detail load failed.
      lastAltitudeState =
        altitudeState === "below" && swapMode === "ellipsoid"
          ? null
          : altitudeState;
      viewer.scene.requestRender();
    }

    if (viewer && !viewer.isDestroyed()) {
      await waitForGlobeReady(swapMode);
    }

    activeSwapCount = Math.max(0, activeSwapCount - 1);

    if (overlay && activeSwapCount === 0 && viewer && !viewer.isDestroyed()) {
      await fadeOverlayTo(overlay, 0, TERRAIN_TRANSITION_FADE_OUT_MS);
    }
  };

  const onCameraChanged = () => {
    if (!viewer || viewer.isDestroyed()) return;
    const newState = computeAltitudeState(getCameraHeight());
    if (newState === lastAltitudeState) return;
    const id = ++requestId;
    applyTerrain(id);
  };

  // Default percentageChanged is 0.5 (50% view-rect change), which lets
  // slow zooms cross the altitude threshold long before camera.changed
  // fires. Tighten it so onCameraChanged sees threshold crossings near
  // when they actually happen. useCameraManager's listener does its own
  // distance/height debouncing so it tolerates the higher frequency.
  viewer.camera.percentageChanged = 0.01;
  viewer.camera.changed.addEventListener(onCameraChanged);

  const initialId = ++requestId;
  applyTerrain(initialId);

  const storeUnsubscribe = useViewerStore.subscribe((state) => {
    if (state.vizBaseUrl === prevVizBase) return;
    const oldUrl = prevVizBase ? `${prevVizBase}terrain/` : null;
    prevVizBase = state.vizBaseUrl;
    if (!viewer || viewer.isDestroyed()) return;
    if (oldUrl) {
      sharedHighDetailTerrainCache.delete(oldUrl);
    }
    const id = ++requestId;
    applyTerrain(id);
  });

  vizTerrainUnsubscribe = () => {
    storeUnsubscribe();
    try {
      if (viewer && !viewer.isDestroyed()) {
        viewer.camera.changed.removeEventListener(onCameraChanged);
      }
    } catch {
      // viewer may already be torn down
    }
    // Invalidate any in-flight applyTerrain from this closure so a stale
    // commit can't clobber a fresh subscription's swap after teardown.
    ++requestId;
    // Don't leave the overlay up if we tear down mid-swap.
    activeSwapCount = 0;
    const overlay = transitionOverlays.get(viewer);
    if (overlay) {
      overlay.style.transition = "opacity 0ms";
      overlay.style.opacity = "0";
    }
  };
}

/**
 * Initializes and manages the Cesium viewer instance
 */
export const useCesiumViewer = ({
  isClient,
  containerRef,
  onViewerReady,
  onError,
}: CesiumViewerOptions) => {
  const viewerRef = useRef<any | null>(null);
  const initializingRef = useRef(false);
  const cleanupDoneRef = useRef(false);
  const keepAliveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);
  const hasCalledReadyRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;

    if (!isClient || !containerRef.current || !window.Cesium) {
      return;
    }

    // If we already have a global viewer instance, reuse it
    if (globalViewerInstance && !globalViewerInstance.isDestroyed()) {
      viewerRef.current = globalViewerInstance;
      setupVizTerrainSubscription(globalViewerInstance, window.Cesium);
      // Only call onViewerReady once per component mount
      if (!hasCalledReadyRef.current) {
        hasCalledReadyRef.current = true;
        onViewerReady(globalViewerInstance);
      }
      return;
    }

    // If another component is already initializing, wait for it
    if (globalViewerPromise && initializingRef.current === false) {
      initializingRef.current = true;
      globalViewerPromise
        .then((viewer) => {
          if (mountedRef.current && viewer && !viewer.isDestroyed()) {
            viewerRef.current = viewer;
            globalViewerInstance = viewer;
            // Only call onViewerReady once per component mount
            if (!hasCalledReadyRef.current) {
              hasCalledReadyRef.current = true;
              onViewerReady(viewer);
            }
          }
        })
        .catch((error) => {
          if (mountedRef.current) {
            onError(
              error instanceof Error
                ? error.message
                : "Failed to initialize viewer.",
            );
          }
        })
        .finally(() => {
          initializingRef.current = false;
        });
      return;
    }

    // Only initialize if no one else is doing it
    if (initializingRef.current || viewerRef.current) {
      return;
    }

    initializingRef.current = true;
    cleanupDoneRef.current = false;

    const initializeViewer = async () => {
      try {
        const Cesium = window.Cesium;

        const ionToken = getCesiumIonToken();
        if (ionToken) {
          Cesium.Ion.defaultAccessToken = ionToken;
        }

        // Monkey-patch HTMLCanvasElement.prototype.getContext to set willReadFrequently
        const originalGetContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (
          this: HTMLCanvasElement,
          contextType: string,
          options?: any,
        ) {
          if (contextType === "2d" || contextType === "2D") {
            const modifiedOptions = options || {};
            modifiedOptions.willReadFrequently = true;
            return (originalGetContext as any).call(
              this,
              contextType,
              modifiedOptions,
            );
          }
          return (originalGetContext as any).call(this, contextType, options);
        } as typeof HTMLCanvasElement.prototype.getContext;

        const container = containerRef.current;
        if (!container || !mountedRef.current) {
          throw new Error("Container not available");
        }

        // Camera altitude isn't known yet (useCameraManager restores it
        // after the viewer is ready), so start with ellipsoid;
        // setupVizTerrainSubscription will load and swap in high-detail
        // once the camera lands below the threshold.
        const terrainProvider = getSharedEllipsoidProvider(Cesium);

        // Load saved base layer preference or use default.
        // Ion layers are async and can't be used in the constructor, so fall
        // back to the default for initial creation and switch after.
        const savedBaseLayerId = loadBaseLayerId() || DEFAULT_BASE_LAYER_ID;
        const initLayerConfig =
          getBaseLayerById(savedBaseLayerId)?.type === "ion"
            ? getBaseLayerById(DEFAULT_BASE_LAYER_ID)!
            : getBaseLayerById(savedBaseLayerId) ||
              getBaseLayerById(DEFAULT_BASE_LAYER_ID)!;
        const imageryProvider = createImageryProvider(Cesium, initLayerConfig);

        const viewer = new Cesium.Viewer(container, {
          baseLayer: new Cesium.ImageryLayer(imageryProvider),
          timeline: false,
          animation: false,
          homeButton: false,
          sceneModePicker: false,
          baseLayerPicker: false, // Disable to avoid Ion imagery requests
          geocoder: false, // Disable to avoid Ion geocoding service
          selectionIndicator: false,
          infoBox: false,
          requestRenderMode: true,
          terrainProvider: terrainProvider,
        });
        // Disable the Viewer's built-in click-to-select handler so selection
        // is fully controlled by usePickingHandlers
        viewer.screenSpaceEventHandler.removeInputAction(
          Cesium.ScreenSpaceEventType.LEFT_CLICK,
        );
        viewer.screenSpaceEventHandler.removeInputAction(
          Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK,
        );

        // If the saved layer was Ion, switch to it now that the viewer exists
        if (getBaseLayerById(savedBaseLayerId)?.type === "ion") {
          changeBaseLayer(viewer, savedBaseLayerId);
        }

        // Configure camera and terrain
        viewer.scene.screenSpaceCameraController.minimumZoomDistance = 30;
        viewer.scene.globe.depthTestAgainstTerrain = true;

        // Track consecutive provider-level failures per layer to distinguish
        // individual tile 404s (normal) from total provider outages.
        const imageryFailureCounts = new WeakMap<any, number>();
        const IMAGERY_FAILURE_THRESHOLD = 20;

        const retryImageryProvider = async (imageryLayer: any) => {
          if (!viewer || viewer.isDestroyed()) return;

          try {
            const layers = viewer.imageryLayers;
            const index = layers.indexOf(imageryLayer);
            if (index >= 0) {
              const currentBaseLayerId =
                loadBaseLayerId() || DEFAULT_BASE_LAYER_ID;
              const config =
                getBaseLayerById(currentBaseLayerId) ||
                getBaseLayerById(DEFAULT_BASE_LAYER_ID)!;
              const newProvider = createImageryProvider(Cesium, config);
              layers.remove(imageryLayer, false);
              layers.addImageryProvider(newProvider, index);
            }
          } catch (error) {
            console.warn("[CesiumViewer] Imagery retry failed:", error);
          }
        };

        // Monitor for imagery provider errors
        const monitorImageryLayers = () => {
          if (!viewer || viewer.isDestroyed()) return;

          const layers = viewer.imageryLayers;
          for (let i = 0; i < layers.length; i++) {
            const layer = layers.get(i);
            if (layer && layer.imageryProvider) {
              // Remove existing listener if any
              if ((layer as any)._errorListener) {
                layer.imageryProvider.errorEvent.removeEventListener(
                  (layer as any)._errorListener,
                );
              }

              // Add error listener that only recreates the provider after
              // many consecutive failures (provider outage), not for normal
              // individual tile 404s (e.g., ocean tiles on OSM).
              const errorListener = (_error: any) => {
                const count = (imageryFailureCounts.get(layer) ?? 0) + 1;
                imageryFailureCounts.set(layer, count);

                if (count >= IMAGERY_FAILURE_THRESHOLD) {
                  console.warn(
                    `[CesiumViewer] Imagery provider hit ${count} errors, recreating provider`,
                  );
                  imageryFailureCounts.set(layer, 0);
                  setTimeout(() => retryImageryProvider(layer), 2000);
                }
              };

              (layer as any)._errorListener = errorListener;
              layer.imageryProvider.errorEvent.addEventListener(errorListener);
            }
          }
        };

        // Initial monitoring setup
        monitorImageryLayers();

        // Re-monitor when layers change
        viewer.imageryLayers.layerAdded.addEventListener(() => {
          monitorImageryLayers();
        });

        // Add visibility change listener for when tab becomes visible again
        const handleVisibilityChange = () => {
          if (!document.hidden && viewer && !viewer.isDestroyed()) {
            // Continuous rendering will handle the actual rendering
            // This just ensures the scene wakes up properly
            try {
              viewer.scene.morphTime; // Touch the scene
              // Also check if providers need to be retried
              monitorImageryLayers();
            } catch (error) {
              console.warn(
                "[CesiumViewer] Visibility change handler failed:",
                error,
              );
            }
          }
        };

        document.addEventListener("visibilitychange", handleVisibilityChange);

        // Store the handler for cleanup
        (viewer as any)._visibilityChangeHandler = handleVisibilityChange;

        // Set up keep-alive ping - lighter since we're using continuous rendering
        keepAliveIntervalRef.current = setInterval(() => {
          if (!viewer || viewer.isDestroyed()) return;
          // Just ensure viewer is still responsive - actual rendering happens continuously
          try {
            // Touch the scene to keep it alive
            viewer.scene.morphTime;

            // Check if imagery layers are still healthy
            const layers = viewer.imageryLayers;
            for (let i = 0; i < layers.length; i++) {
              const layer = layers.get(i);
              // Check if layer exists and has a provider with an error event
              if (
                layer &&
                layer.imageryProvider &&
                layer.imageryProvider.errorEvent
              ) {
                // Ensure error listener is still attached
                if (!(layer as any)._errorListener) {
                  monitorImageryLayers();
                  break;
                }
              }
            }
          } catch (error: any) {
            console.error("[CesiumViewer] Keep-alive ping failed:", error);
          }
        }, 60000);

        viewerRef.current = viewer;
        globalViewerInstance = viewer;
        setupVizTerrainSubscription(viewer, Cesium);

        if (!hasCalledReadyRef.current) {
          hasCalledReadyRef.current = true;
          onViewerReady(viewer);
        }

        cleanupDoneRef.current = false;
        initializingRef.current = false;

        return viewer;
      } catch (error) {
        console.error("[CesiumViewer] Failed to initialize:", error);
        initializingRef.current = false;
        globalViewerPromise = null;

        if (mountedRef.current) {
          let errorMessage =
            error instanceof Error
              ? error.message
              : "Failed to initialize viewer.";
          if (
            errorMessage.includes("WebGL") ||
            errorMessage.includes("initialization failed")
          ) {
            errorMessage =
              "WebGL initialization failed. This usually happens after multiple page reloads. Please close and reopen your browser, then try again.";
          }
          onError(errorMessage);
        }

        throw error;
      }
    };

    // Store the promise globally
    globalViewerPromise = initializeViewer();

    return () => {
      mountedRef.current = false;

      if (cleanupDoneRef.current) return;
      cleanupDoneRef.current = true;

      // Clean up keep-alive interval
      if (keepAliveIntervalRef.current) {
        clearInterval(keepAliveIntervalRef.current);
        keepAliveIntervalRef.current = null;
      }

      // Clean up visibility change listener
      if (
        globalViewerInstance &&
        (globalViewerInstance as any)._visibilityChangeHandler
      ) {
        document.removeEventListener(
          "visibilitychange",
          (globalViewerInstance as any)._visibilityChangeHandler,
        );
        (globalViewerInstance as any)._visibilityChangeHandler = null;
      }

      // Reset the ready callback flag so it can be called again on remount
      hasCalledReadyRef.current = false;

      // DON'T destroy the global viewer instance in cleanup
      // This allows it to be reused if the component remounts (e.g., in StrictMode)
      viewerRef.current = null;
      initializingRef.current = false;
    };
  }, [isClient, containerRef, onViewerReady, onError]);

  return viewerRef.current;
};
