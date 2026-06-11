/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {
  useState,
  useEffect,
  useRef,
  useLayoutEffect,
  useCallback,
} from "react";
import {
  minioClient,
  normalizeIcebergNamespace,
  resolveAvailableNamespaceSelection,
} from "@/services/database";
import { databaseManager } from "../../managers/databaseManager";
import {
  useViewerStore,
  refreshGisTilesetsFromStorage,
} from "../../store/viewerStore";
import { radioUnitManager } from "../../managers/radioUnitManager";
import { distributedUnitManager } from "../../managers/distributedUnitManager";
import { scattererManager } from "../../managers/scattererManager";
import { userEquipmentManager } from "../../managers/userEquipmentManager";
import { spawnZoneManager } from "../../managers/spawnZoneManager";
import {
  MINIO_SETTINGS_MERGED_EVENT,
  fetchAvailableMaterials,
  suppressSync,
  resumeSync,
} from "../../managers/ymlConfigLoader";

type S3Provider = "aws" | "minio";
type CatalogType = "rest" | "glue";

interface ConnectionForm {
  catalogType: CatalogType;
  /** AWS Region for Glue Data Catalog (REST catalog ignores this for the URI). */
  glueRegion: string;
  catalogUri: string;
  s3Endpoint: string;
  s3BucketName: string;
  s3Provider: S3Provider;
  accessKey: string;
  secretKey: string;
}

const STORAGE_KEY_SETTINGS = "minio_settings";

const CREDENTIAL_SETUP_SNIPPET = `# Generate ~/.aws/credentials
mkdir -p ~/.aws
cat > ~/.aws/credentials << EOF
[default]
aws_access_key_id = \${MINIO_ACCESS_KEY}
aws_secret_access_key = \${MINIO_SECRET_KEY}
EOF

# Generate ~/.aws/config
cat > ~/.aws/config << EOF
[default]
region = us-east-1
endpoint_url = http://$(hostname -I | awk '{print $1}'):\${MINIO_PORT}
EOF`;

interface MinIOSettingsProps {
  shouldAutoConnect?: boolean;
}

export const MinIOSettings: React.FC<MinIOSettingsProps> = ({
  shouldAutoConnect = false,
}) => {
  const { triggerTimelineRefresh, setDataSourceType } = useViewerStore();
  const [isExpanded, setIsExpanded] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [hasAttemptedAutoConnect, setHasAttemptedAutoConnect] = useState(false);
  const [showCredentialInfo, setShowCredentialInfo] = useState(false);
  const credentialInfoRef = useRef<HTMLDivElement>(null);
  const [popoverStyle, setPopoverStyle] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const [credentialCopied, setCredentialCopied] = useState(false);

  const POPOVER_WIDTH = 420;
  const POPOVER_HEIGHT_ESTIMATE = 340;
  const VIEWPORT_PAD = 8;

  // Load settings from localStorage (merges with defaults to handle format changes)
  const getInitialSettings = useCallback((): ConnectionForm => {
    const defaults: ConnectionForm = {
      catalogType: "rest",
      glueRegion: "us-east-1",
      catalogUri: "",
      s3Endpoint: "",
      s3BucketName: "",
      s3Provider: "minio",
      accessKey: "",
      secretKey: "",
    };
    try {
      const saved = localStorage.getItem(STORAGE_KEY_SETTINGS);
      if (saved) {
        const parsed = JSON.parse(saved) as Record<string, unknown>;
        const legacy =
          typeof parsed.warehouse === "string" ? parsed.warehouse : "";
        const bucket =
          (typeof parsed.s3BucketName === "string"
            ? parsed.s3BucketName
            : "") || legacy;
        return { ...defaults, ...parsed, s3BucketName: bucket };
      }
    } catch (error) {
      console.error(
        "[MinIO Settings] Failed to load saved connection settings:",
        error,
      );
    }
    return defaults;
  }, []);

  const [formData, setFormData] = useState<ConnectionForm>(() =>
    getInitialSettings(),
  );
  const formDataRef = useRef(formData);
  formDataRef.current = formData;
  const [databases, setDatabases] = useState<string[]>([]);
  const [selectedDatabase, setSelectedDatabase] = useState<string>("");

  // Check initial connection status and auto-connect if needed (only on mount)
  useEffect(() => {
    const initializeConnection = async () => {
      const connected = minioClient.isConnected();
      setIsConnected(connected);

      // Only load databases if we're doing an auto-connect
      // Don't load on initial mount just because isConnected is true from localStorage
      if (connected && shouldAutoConnect) {
        try {
          await loadDatabases();
          // Restore the current database from the client
          const currentDb = minioClient.getCurrentDatabase();
          if (currentDb) {
            setSelectedDatabase(currentDb);
          }
        } catch (error) {
          // Silently handle errors on initialization
          // This is expected when the app restarts or routes aren't ready yet
          console.warn(
            "[MinIO Settings] Failed to load databases on initialization:",
            error,
          );
          // Don't disconnect or show error - just skip loading for now
        }
      }

      // Auto-connect only if:
      // 1. This is the initial page load (shouldAutoConnect is true)
      // 2. This is the active data source
      // 3. We have saved settings
      const canAutoConnectCatalog =
        formData.catalogType === "glue" || !!formData.catalogUri?.trim();

      if (
        shouldAutoConnect &&
        !connected &&
        !hasAttemptedAutoConnect &&
        canAutoConnectCatalog
      ) {
        setHasAttemptedAutoConnect(true);
        await handleConnect();
      }
    };

    initializeConnection();
  }, []); // Only run on mount

  // Position popover so it stays within viewport
  useLayoutEffect(() => {
    if (!showCredentialInfo || !credentialInfoRef.current) {
      setPopoverStyle(null);
      return;
    }
    const rect = credentialInfoRef.current.getBoundingClientRect();
    const viewportW = window.innerWidth;
    const spaceLeft = rect.left;
    const spaceRight = viewportW - rect.right;
    // Prefer showing to the left of the icon; if not enough room, show to the right
    let left: number;
    if (spaceLeft >= POPOVER_WIDTH + VIEWPORT_PAD) {
      left = rect.left - POPOVER_WIDTH - VIEWPORT_PAD;
    } else {
      left = rect.right + VIEWPORT_PAD;
    }
    left = Math.max(
      VIEWPORT_PAD,
      Math.min(left, viewportW - POPOVER_WIDTH - VIEWPORT_PAD),
    );
    const viewportH = window.innerHeight;
    const top = Math.max(
      VIEWPORT_PAD,
      Math.min(rect.top, viewportH - POPOVER_HEIGHT_ESTIMATE - VIEWPORT_PAD),
    );
    setPopoverStyle({ left, top });
  }, [showCredentialInfo]);

  // Close credential info popover when clicking outside
  useEffect(() => {
    if (!showCredentialInfo) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        credentialInfoRef.current &&
        !credentialInfoRef.current.contains(e.target as Node)
      ) {
        setShowCredentialInfo(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showCredentialInfo]);

  // Save settings to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(formData));
    } catch (error) {
      console.error(
        "[MinIO Settings] Failed to save connection settings:",
        error,
      );
    }
  }, [formData]);

  // Flush latest edits when leaving the panel (tab switch unmounts this tree)
  useEffect(() => {
    return () => {
      try {
        localStorage.setItem(
          STORAGE_KEY_SETTINGS,
          JSON.stringify(formDataRef.current),
        );
      } catch {
        // ignore
      }
    };
  }, []);

  // Rebuild 3D Tiles URLs when the S3 endpoint is edited (localStorage already updated above)
  useEffect(() => {
    const timer = window.setTimeout(() => {
      refreshGisTilesetsFromStorage();
    }, 400);
    return () => window.clearTimeout(timer);
  }, [formData.s3Endpoint]);

  // When YML is applied, connection fields may be merged into localStorage — refresh the form
  useEffect(() => {
    const syncFromStorage = () => setFormData(getInitialSettings());
    window.addEventListener(MINIO_SETTINGS_MERGED_EVENT, syncFromStorage);
    return () =>
      window.removeEventListener(MINIO_SETTINGS_MERGED_EVENT, syncFromStorage);
  }, [getInitialSettings]);

  // Load available databases (namespaces from catalog, or directories from MinIO)
  const loadDatabases = async () => {
    try {
      let dbs: string[];

      if (minioClient.hasCatalog()) {
        // Catalog mode: list namespaces from Iceberg REST catalog
        dbs = await minioClient.getNamespacesFromCatalog();
      } else {
        // Legacy: list directories from MinIO bucket
        dbs = await minioClient.getDatabases();
      }

      setDatabases(dbs);

      if (dbs.length > 0) {
        const preferredDatabase =
          selectedDatabase || minioClient.getCurrentDatabase();
        const nextDb = resolveAvailableNamespaceSelection(
          dbs,
          preferredDatabase,
        );
        setSelectedDatabase(nextDb);
        minioClient.setCurrentDatabase(nextDb);
      } else {
        setSelectedDatabase("");
        minioClient.setCurrentDatabase("");
      }
    } catch (error) {
      console.error("[MinIO Settings] Failed to load databases:", error);
      setDatabases([]);
    }
  };

  // Handle database selection change
  const handleDatabaseChange = async (database: string) => {
    const dbValue =
      database === "(root)" ? "" : normalizeIcebergNamespace(database);
    setSelectedDatabase(dbValue);
    minioClient.setCurrentDatabase(dbValue);
    // Reset load state when switching databases
    setHasLoadedOnce(false);
  };

  // Main load database function
  const loadDatabase = async () => {
    if (!isConnected) {
      console.warn("[MinIO Settings] Cannot load: not connected");
      return;
    }

    // Set the current database in the MinIO client BEFORE loading
    minioClient.setCurrentDatabase(selectedDatabase);

    // Set MinIO as the active data source FIRST
    // (so databaseManager.isReady() checks the right source)
    setDataSourceType("minio");

    if (!databaseManager.isReady()) {
      console.warn("[MinIO Settings] Cannot load: DatabaseManager not ready");
      return;
    }

    setIsLoading(true);
    suppressSync();
    try {
      // Clear existing entities from viewer and state before loading
      databaseManager.clearAll();
      radioUnitManager.clear();
      distributedUnitManager.clear();
      scattererManager.clear();
      userEquipmentManager.clear();

      // Execute full load
      await databaseManager.loadAll();

      // Re-trigger spawn zone visualization
      const szPoints = spawnZoneManager.getPoints();
      if (szPoints && szPoints.length >= 3) {
        spawnZoneManager.set(szPoints, spawnZoneManager.getAltitude());
      }

      // Trigger timeline refresh in viewer store
      triggerTimelineRefresh();

      // Mark that we've successfully loaded at least once
      setHasLoadedOnce(true);
    } catch (error) {
      console.error("[MinIO Settings] Failed to load:", error);
    } finally {
      resumeSync();
      setIsLoading(false);
    }
  };

  const handleConnect = async () => {
    setIsConnecting(true);
    setConnectionError(null);

    let normalizedCatalogUri = "";
    if (formData.catalogType === "rest") {
      normalizedCatalogUri = formData.catalogUri.trim();
      if (normalizedCatalogUri && !/^https?:\/\//i.test(normalizedCatalogUri)) {
        normalizedCatalogUri = `http://${normalizedCatalogUri}`;
      }
    }

    let normalizedS3Endpoint = formData.s3Endpoint.trim();
    if (formData.s3Provider === "aws") {
      normalizedS3Endpoint = "";
    } else if (
      normalizedS3Endpoint &&
      !/^https?:\/\//i.test(normalizedS3Endpoint)
    ) {
      normalizedS3Endpoint = `http://${normalizedS3Endpoint}`;
    }

    try {
      const accessKey = formData.accessKey.trim();
      const secretKey = formData.secretKey.trim();

      const result =
        formData.catalogType === "glue"
          ? await minioClient.connect({
              baseUrl: "",
              catalogType: "glue",
              glueRegion: formData.glueRegion.trim() || "us-east-1",
              s3Endpoint: normalizedS3Endpoint,
              s3BucketName: formData.s3BucketName,
              ...(accessKey ? { accessKey } : {}),
              ...(secretKey ? { secretKey } : {}),
            })
          : await minioClient.connect({
              baseUrl: "",
              catalogUri: normalizedCatalogUri,
              s3Endpoint: normalizedS3Endpoint,
              s3BucketName: formData.s3BucketName,
              ...(accessKey ? { accessKey } : {}),
              ...(secretKey ? { secretKey } : {}),
            });

      if (result.success) {
        setIsConnected(true);
        // Load databases (namespaces) after successful connection
        await loadDatabases();
        fetchAvailableMaterials();
      } else {
        setConnectionError(result.error || "Failed to connect");
      }
    } catch (error) {
      setConnectionError(
        error instanceof Error ? error.message : "Connection failed",
      );
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = () => {
    minioClient.disconnect();
    setIsConnected(false);
    setHasLoadedOnce(false);
    setDatabases([]);
    setSelectedDatabase("");

    // Clear the database manager and entities
    databaseManager.clearAll();
    radioUnitManager.clear();
    distributedUnitManager.clear();
    scattererManager.clear();
    userEquipmentManager.clear();

    // Trigger a timeline refresh to update UI
    triggerTimelineRefresh();
  };

  const handleInputChange = (
    field: keyof ConnectionForm,
    value: string | CatalogType | S3Provider,
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 py-2">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="hover:bg-gray-800/30 transition-colors py-1 rounded min-w-0 flex-shrink"
        >
          <h2 className="text-sm font-semibold text-gray-200 leading-tight text-left">
            Iceberg Catalog
          </h2>
        </button>
        <div className="relative flex-shrink-0" ref={credentialInfoRef}>
          <button
            type="button"
            onClick={() => setShowCredentialInfo((v) => !v)}
            className="p-0.5 rounded text-gray-400 hover:text-gray-200 hover:bg-gray-800/30 transition-colors focus:outline-none focus:ring-1 focus:ring-[#76B900]"
            title="AWS/MinIO credential setup"
          >
            <svg
              className="w-4 h-4"
              fill="currentColor"
              viewBox="0 0 20 20"
              aria-hidden
            >
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                clipRule="evenodd"
              />
            </svg>
          </button>
          {showCredentialInfo && popoverStyle && (
            <div
              className="fixed z-50 w-[max(280px,90vw)] max-w-[420px] bg-gray-800 border border-gray-600 rounded-lg shadow-xl p-3"
              style={{ left: popoverStyle.left, top: popoverStyle.top }}
              onMouseDown={(e) => e.preventDefault()}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <p className="text-xs text-gray-300 font-medium flex-1 min-w-0">
                  AWS/MinIO credential setup (e.g. on the client machine)
                </p>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(
                        CREDENTIAL_SETUP_SNIPPET,
                      );
                      setCredentialCopied(true);
                      setTimeout(() => setCredentialCopied(false), 2000);
                    } catch {
                      // ignore
                    }
                  }}
                  className="flex-shrink-0 px-2 py-1 text-xs font-medium rounded bg-gray-700 text-gray-200 hover:bg-gray-600 focus:outline-none focus:ring-1 focus:ring-[#76B900]"
                >
                  {credentialCopied ? "Copied!" : "Copy"}
                </button>
              </div>
              <pre className="text-[11px] text-gray-400 font-mono whitespace-pre overflow-x-auto bg-gray-900 rounded p-2 border border-gray-700">
                {CREDENTIAL_SETUP_SNIPPET}
              </pre>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
          {/* Connect/Disconnect Button */}
          <button
            onClick={isConnected ? handleDisconnect : handleConnect}
            disabled={isConnecting}
            className={`w-[90px] px-2 py-1.5 text-xs font-medium rounded transition-colors ${
              isConnected
                ? "bg-gray-600 hover:bg-gray-700 text-gray-200"
                : "bg-[#76B900] hover:bg-[#6BA000] text-black"
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {isConnecting
              ? "Connecting..."
              : isConnected
                ? "Disconnect"
                : "Connect"}
          </button>

          {/* Expand/Collapse Arrow */}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="hover:bg-gray-800/30 transition-colors p-1 rounded flex-shrink-0"
          >
            <svg
              className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      {isExpanded && (
        <div className="py-3 space-y-4">
          {/* Connection Section */}
          <div className="space-y-3">
            {!isConnected ? (
              <div className="space-y-3">
                {/* Catalog type */}
                <div>
                  <label className="block text-xs text-gray-400 mb-2">
                    Catalog type
                  </label>
                  <div className="flex gap-4 flex-wrap">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="catalogType"
                        value="rest"
                        checked={formData.catalogType === "rest"}
                        onChange={() =>
                          handleInputChange("catalogType", "rest")
                        }
                        disabled={isConnecting}
                        className="rounded border-gray-600 bg-gray-800 text-[#76B900] focus:ring-[#76B900]"
                      />
                      <span className="text-sm text-gray-200">REST</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="catalogType"
                        value="glue"
                        checked={formData.catalogType === "glue"}
                        onChange={() =>
                          handleInputChange("catalogType", "glue")
                        }
                        disabled={isConnecting}
                        className="rounded border-gray-600 bg-gray-800 text-[#76B900] focus:ring-[#76B900]"
                      />
                      <span className="text-sm text-gray-200">AWS Glue</span>
                    </label>
                  </div>
                </div>

                {formData.catalogType === "rest" ? (
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Catalog URI
                    </label>
                    <input
                      type="text"
                      value={formData.catalogUri}
                      onChange={(e) =>
                        handleInputChange("catalogUri", e.target.value)
                      }
                      placeholder="http://your-catalog-host:19120/iceberg/"
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200 focus:outline-none focus:border-[#76B900]"
                      disabled={isConnecting}
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Iceberg REST catalog endpoint (e.g., Nessie)
                    </p>
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      AWS Region (Glue)
                    </label>
                    <input
                      type="text"
                      value={formData.glueRegion}
                      onChange={(e) =>
                        handleInputChange("glueRegion", e.target.value)
                      }
                      placeholder="us-east-1"
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200 focus:outline-none focus:border-[#76B900]"
                      disabled={isConnecting}
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Region of your AWS Glue Data Catalog and S3 data (used by
                      the server for Glue and S3 access).
                    </p>
                  </div>
                )}

                {/* S3 credentials (optional; sent to the MinIO proxy for authenticated requests) */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Access key
                    </label>
                    <input
                      type="text"
                      autoComplete="off"
                      value={formData.accessKey}
                      onChange={(e) =>
                        handleInputChange("accessKey", e.target.value)
                      }
                      placeholder="Optional"
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200 focus:outline-none focus:border-[#76B900]"
                      disabled={isConnecting}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Secret key
                    </label>
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={formData.secretKey}
                      onChange={(e) =>
                        handleInputChange("secretKey", e.target.value)
                      }
                      placeholder="Optional"
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200 focus:outline-none focus:border-[#76B900]"
                      disabled={isConnecting}
                    />
                  </div>
                </div>
                <p className="text-xs text-gray-500">
                  Optional: sent to the server for AWS Glue, S3, or MinIO.
                </p>

                {/* S3 Provider Choice */}
                <div>
                  <label className="block text-xs text-gray-400 mb-2">
                    S3 Provider
                  </label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="s3Provider"
                        value="minio"
                        checked={formData.s3Provider === "minio"}
                        onChange={() =>
                          handleInputChange("s3Provider", "minio")
                        }
                        disabled={isConnecting}
                        className="rounded border-gray-600 bg-gray-800 text-[#76B900] focus:ring-[#76B900]"
                      />
                      <span className="text-sm text-gray-200">MinIO</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="s3Provider"
                        value="aws"
                        checked={formData.s3Provider === "aws"}
                        onChange={() => handleInputChange("s3Provider", "aws")}
                        disabled={isConnecting}
                        className="rounded border-gray-600 bg-gray-800 text-[#76B900] focus:ring-[#76B900]"
                      />
                      <span className="text-sm text-gray-200">AWS</span>
                    </label>
                  </div>
                </div>

                {/* S3 Endpoint Input (MinIO only; disabled for AWS) */}
                <div>
                  <label
                    className={`block text-xs mb-1 ${formData.s3Provider === "aws" ? "text-gray-500" : "text-gray-400"}`}
                  >
                    S3 / MinIO Endpoint
                  </label>
                  <input
                    type="text"
                    value={
                      formData.s3Provider === "aws" ? "" : formData.s3Endpoint
                    }
                    onChange={(e) =>
                      handleInputChange("s3Endpoint", e.target.value)
                    }
                    placeholder={
                      formData.s3Provider === "aws"
                        ? "Uses default AWS S3"
                        : "http://your-s3-host:9000"
                    }
                    className={`w-full px-3 py-2 border rounded text-sm focus:outline-none focus:border-[#76B900] ${
                      formData.s3Provider === "aws"
                        ? "bg-gray-800/50 border-gray-700 text-gray-500 cursor-not-allowed"
                        : "bg-gray-800 border-gray-700 text-gray-200"
                    }`}
                    disabled={isConnecting || formData.s3Provider === "aws"}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    {formData.s3Provider === "aws"
                      ? "Endpoint is not used; default AWS S3 is used."
                      : "S3-compatible storage endpoint"}
                  </p>
                </div>

                {/* S3 bucket (Iceberg data / GIS tiles root segment) */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    S3 Bucket Name
                  </label>
                  <input
                    type="text"
                    value={formData.s3BucketName}
                    onChange={(e) =>
                      handleInputChange("s3BucketName", e.target.value)
                    }
                    placeholder="parquet-export-test"
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200 focus:outline-none focus:border-[#76B900]"
                    disabled={isConnecting}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Name of the S3 bucket that holds Iceberg tables (and GIS
                    tiles when used with scene URL)
                  </p>
                </div>

                {/* Connection Error */}
                {connectionError && (
                  <div className="text-xs text-red-400 bg-red-900/20 border border-red-800 rounded p-2">
                    {connectionError}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {/* Connection Info */}
                <div className="bg-gray-800/50 border border-gray-700 rounded p-3 text-xs space-y-1">
                  <div className="flex flex-col gap-1">
                    <span className="text-gray-400">Catalog:</span>
                    <span className="text-gray-200 break-all">
                      {formData.catalogType === "glue"
                        ? `AWS Glue (${formData.glueRegion.trim() || "us-east-1"})`
                        : formData.catalogUri}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-gray-400">S3 Endpoint:</span>
                    <span className="text-gray-200 break-all">
                      {formData.s3Provider === "aws"
                        ? "Default AWS S3"
                        : formData.s3Endpoint || "—"}
                    </span>
                  </div>
                  {formData.s3BucketName && (
                    <div className="flex flex-col gap-1">
                      <span className="text-gray-400">S3 bucket:</span>
                      <span className="text-gray-200 break-all">
                        {formData.s3BucketName}
                      </span>
                    </div>
                  )}
                </div>

                {/* Available Databases (Namespaces) Section */}
                <div>
                  <label className="block text-xs text-gray-400 mb-2">
                    Available Databases
                  </label>
                  {databases.length > 0 ? (
                    <div className="space-y-2">
                      <select
                        value={
                          selectedDatabase === "" ? "(root)" : selectedDatabase
                        }
                        onChange={(e) => handleDatabaseChange(e.target.value)}
                        className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200 focus:outline-none focus:border-[#76B900]"
                      >
                        {databases.map((db) => (
                          <option key={db} value={db}>
                            {db}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-gray-500">
                        Found {databases.length} database
                        {databases.length === 1 ? "" : "s"} (namespace
                        {databases.length === 1 ? "" : "s"})
                      </p>
                    </div>
                  ) : (
                    <div className="text-xs text-gray-500 bg-gray-800/50 border border-gray-700 rounded p-2">
                      Loading databases...
                    </div>
                  )}
                </div>

                {/* Load/Refresh Button */}
                <button
                  onClick={loadDatabase}
                  disabled={isLoading}
                  className="w-full py-2 px-4 bg-[#76B900] hover:bg-[#6BA000] text-black font-medium rounded text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title={
                    hasLoadedOnce
                      ? "Refresh and reload entities from MinIO"
                      : "Load and visualize entities from MinIO"
                  }
                >
                  {isLoading
                    ? "Loading..."
                    : hasLoadedOnce
                      ? "Refresh"
                      : "Load"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Divider */}
      <div className="border-t border-gray-700 my-3"></div>
    </div>
  );
};
