"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import DropZone from "@/components/DropZone";
import SettingsPanel from "@/components/SettingsPanel";
import StatusBar from "@/components/StatusBar";
import TopBar, { type Team } from "@/components/TopBar";
import RespawnPanel, { type RespawnStage, type RespawnStats } from "@/components/RespawnPanel";
import HypePanel, { type HypeStage, type HypeMoment } from "@/components/HypePanel";
import PipelinePanel, {
  type PipelineStage,
  type PipelineSummary,
} from "@/components/PipelinePanel";
import YouTubePanel, { type YouTubePublishStage } from "@/components/YouTubePanel";
import { parseApiError } from "@/lib/api";
import { supabase } from "@/lib/supabase";

const BASE =
  process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, "") ?? "http://localhost:8000";

// Dead space removal state machine — exactly these five states:
//   idle       → no file selected
//   ready      → file uploaded, job_id stored, settings visible
//   processing → "Remove Dead Space" clicked, polling /status
//   done       → job finished, download available
//   error      → any fetch failed, errorMsg stored
type Stage = "idle" | "ready" | "processing" | "done" | "error";

const DEFAULT_THRESHOLD = -35;
const DEFAULT_DURATION = 0.5;
const DEFAULT_BLACK_THRESHOLD = 0.1;
const DEFAULT_RESPAWN_MIN_DURATION = 1.5;
const DEFAULT_AUDIO_SENSITIVITY = 0.7;
const DEFAULT_MOTION_SENSITIVITY = 0.6;
const DEFAULT_MIN_GAP = 3.0;
const DEFAULT_PIPELINE_DEAD_SPACE_ENABLED = true;
const DEFAULT_PIPELINE_RESPAWN_ENABLED = true;
const DEFAULT_PIPELINE_HYPE_ENABLED = true;

export default function Home() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // ── Auth state ──
  const [userEmail, setUserEmail] = useState<string>("");
  const [isAuthChecked, setIsAuthChecked] = useState(false);

  // ── Billing state ──
  const [billingPlan, setBillingPlan] = useState<string>("free");
  const [billingVideosUsed, setBillingVideosUsed] = useState<number>(0);
  const [billingLimit, setBillingLimit] = useState<number | null>(3);

  // ── Teams / workspace state ──
  const [teams, setTeams] = useState<Team[]>([]);
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [createTeamError, setCreateTeamError] = useState("");

  useEffect(() => {
    // Check session on mount; redirect to /auth if unauthenticated
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.push("/auth");
      } else {
        setUserEmail(session.user.email ?? "");
        setIsAuthChecked(true);
        // Fetch billing status and teams in the background
        const token = session.access_token;
        fetch(`${BASE}/billing/status`, { headers: { Authorization: `Bearer ${token}` } })
          .then((r) => r.ok ? r.json() : null)
          .then((data) => {
            if (data) {
              setBillingPlan(data.plan ?? "free");
              setBillingVideosUsed(data.videos_this_month ?? 0);
              setBillingLimit(data.limit ?? null);
            }
          })
          .catch(() => undefined);
        fetch(`${BASE}/teams`, { headers: { Authorization: `Bearer ${token}` } })
          .then((r) => r.ok ? r.json() : null)
          .then((data) => {
            if (data?.teams) setTeams(data.teams as Team[]);
          })
          .catch(() => undefined);
      }
    });

    // Listen for future auth changes (sign-out in another tab, token expiry, etc.)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!session) {
          router.push("/auth");
        } else {
          setUserEmail(session.user.email ?? "");
        }
      }
    );
    return () => subscription.unsubscribe();
  }, [router]);

  // Handle ?youtube=connected param — both in popup and in main window
  useEffect(() => {
    const param = searchParams.get("youtube");
    if (param === "connected") {
      if (window.opener) {
        // We're in the popup — notify the parent and close
        window.opener.postMessage("youtube_connected", window.location.origin);
        window.close();
      } else {
        // Fallback: main window redirect (no popup)
        setYoutubeConnected(true);
        setYoutubeConnectionChecked(true);
        // Strip the query param so it doesn't persist on refresh
        router.replace("/");
      }
    }
  }, [searchParams, router]);

  // Listen for postMessage from OAuth popup
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data === "youtube_connected") {
        setYoutubeConnected(true);
        setYoutubeConnectionChecked(true);
        youtubePopupRef.current?.close();
        youtubePopupRef.current = null;
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // Check YouTube connection once when a processed video is available
  useEffect(() => {
    if ((stage === "done" || pipelineStage === "done") && !youtubeConnectionChecked) {
      checkYoutubeConnection();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, pipelineStage]);

  // ── Upload / dead space state ──
  const [file, setFile] = useState<File | null>(null);

  const [jobId, setJobId] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [isUploading, setIsUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [thresholdDb, setThresholdDb] = useState<number>(DEFAULT_THRESHOLD);
  const [minSilenceDuration, setMinSilenceDuration] = useState<number>(DEFAULT_DURATION);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Respawn state ──
  const [respawnEnabled, setRespawnEnabled] = useState(false);
  const [blackThreshold, setBlackThreshold] = useState<number>(DEFAULT_BLACK_THRESHOLD);
  const [respawnMinDuration, setRespawnMinDuration] = useState<number>(DEFAULT_RESPAWN_MIN_DURATION);
  const [respawnStage, setRespawnStage] = useState<RespawnStage>("idle");
  const [respawnStats, setRespawnStats] = useState<RespawnStats | null>(null);
  const [respawnErrorMsg, setRespawnErrorMsg] = useState<string>("");

  // ── Pipeline state ──
  const [pipelineMode, setPipelineMode] = useState(false);
  const [pipelineDeadSpaceEnabled, setPipelineDeadSpaceEnabled] = useState(DEFAULT_PIPELINE_DEAD_SPACE_ENABLED);
  const [pipelineRespawnEnabled, setPipelineRespawnEnabled] = useState(DEFAULT_PIPELINE_RESPAWN_ENABLED);
  const [pipelineHypeEnabled, setPipelineHypeEnabled] = useState(DEFAULT_PIPELINE_HYPE_ENABLED);
  const [pipelineStage, setPipelineStage] = useState<PipelineStage>("idle");
  const [pipelineCurrentStep, setPipelineCurrentStep] = useState<string | null>(null);
  const [pipelineStepsCompleted, setPipelineStepsCompleted] = useState<string[]>([]);
  const [pipelinePercent, setPipelinePercent] = useState(0);
  const [pipelineSummary, setPipelineSummary] = useState<PipelineSummary | null>(null);
  const [pipelineErrorMsg, setPipelineErrorMsg] = useState<string>("");
  const [pipelineHasVideoOutput, setPipelineHasVideoOutput] = useState(false);
  const pipelinePollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── YouTube state ──
  const [youtubeConnected, setYoutubeConnected] = useState(false);
  const [youtubeConnectionChecked, setYoutubeConnectionChecked] = useState(false);
  const [youtubePublishStage, setYoutubePublishStage] = useState<YouTubePublishStage>("idle");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [youtubeErrorMsg, setYoutubeErrorMsg] = useState("");
  const youtubePopupRef = useRef<Window | null>(null);

  // ── Hype state ──
  const [hypeEnabled, setHypeEnabled] = useState(false);
  const [audioSensitivity, setAudioSensitivity] = useState<number>(DEFAULT_AUDIO_SENSITIVITY);
  const [motionSensitivity, setMotionSensitivity] = useState<number>(DEFAULT_MOTION_SENSITIVITY);
  const [minGapSeconds, setMinGapSeconds] = useState<number>(DEFAULT_MIN_GAP);
  const [hypeStage, setHypeStage] = useState<HypeStage>("idle");
  const [hypeMoments, setHypeMoments] = useState<HypeMoment[]>([]);
  const [hypeErrorMsg, setHypeErrorMsg] = useState<string>("");

  // ─────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const stopPipelinePolling = () => {
    if (pipelinePollRef.current) {
      clearInterval(pipelinePollRef.current);
      pipelinePollRef.current = null;
    }
  };

  // Returns headers with Authorization token (and optionally Content-Type: application/json).
  // Calls getSession() each time so a refreshed token is always used.
  const getHeaders = async (json = true): Promise<Record<string, string>> => {
    const { data: { session } } = await supabase.auth.getSession();
    const h: Record<string, string> = {};
    if (json) h["Content-Type"] = "application/json";
    if (session?.access_token) h["Authorization"] = `Bearer ${session.access_token}`;
    return h;
  };

  // Download a protected endpoint that returns { download_url } — opens the signed URL in a new tab.
  const downloadSigned = async (url: string): Promise<void> => {
    const headers = await getHeaders(false);
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(await parseApiError(res));
    const { download_url } = await res.json();
    window.open(download_url, "_blank");
  };

  // Download a streaming endpoint (XML exports) as a blob and trigger the save dialog.
  const downloadAuthed = async (url: string, fallbackFilename: string): Promise<void> => {
    const headers = await getHeaders(false);
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(await parseApiError(res));
    const blob = await res.blob();
    const disposition = res.headers.get("Content-Disposition");
    const filename = disposition?.match(/filename="([^"]+)"/)?.[1] ?? fallbackFilename;
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(blobUrl);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/auth");
  };

  // ─────────────────────────────────────────────────────────
  // Team / workspace helpers
  // ─────────────────────────────────────────────────────────

  const handleWorkspaceChange = (teamId: string | null) => {
    setActiveTeamId(teamId);
    // Reset job state so the new workspace starts clean
    stopPolling();
    stopPipelinePolling();
    setFile(null);
    setJobId(null);
    setStage("idle");
    setErrorMsg("");
    setRespawnStage("idle");
    setRespawnStats(null);
    setRespawnErrorMsg("");
    setHypeStage("idle");
    setHypeMoments([]);
    setHypeErrorMsg("");
    setPipelineStage("idle");
    setPipelineCurrentStep(null);
    setPipelineStepsCompleted([]);
    setPipelinePercent(0);
    setPipelineSummary(null);
    setPipelineHasVideoOutput(false);
    setPipelineErrorMsg("");
    setYoutubePublishStage("idle");
    setYoutubeUrl("");
    setYoutubeErrorMsg("");
    setYoutubeConnectionChecked(false);
  };

  const handleCreateTeam = async () => {
    const name = newTeamName.trim();
    if (!name) return;
    setCreatingTeam(true);
    setCreateTeamError("");
    try {
      const res = await fetch(`${BASE}/teams`, {
        method: "POST",
        headers: await getHeaders(),
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const d = await res.json();
        setCreateTeamError(d.detail ?? "Failed to create team.");
        return;
      }
      const team = await res.json();
      setTeams((prev) => [...prev, { id: team.id, name: team.name, role: "owner" }]);
      setActiveTeamId(team.id);
      setShowCreateTeam(false);
      setNewTeamName("");
    } catch {
      setCreateTeamError("Network error. Please try again.");
    } finally {
      setCreatingTeam(false);
    }
  };

  // ─────────────────────────────────────────────────────────
  // YouTube helpers
  // ─────────────────────────────────────────────────────────

  const checkYoutubeConnection = async () => {
    try {
      const res = await fetch(`${BASE}/auth/youtube/status`, {
        headers: await getHeaders(false),
      });
      if (res.ok) {
        const data = await res.json();
        setYoutubeConnected(data.connected === true);
      }
    } catch {
      // non-fatal
    } finally {
      setYoutubeConnectionChecked(true);
    }
  };

  const handleConnectYouTube = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;
    const url = `${BASE}/auth/youtube?token=${encodeURIComponent(session.access_token)}`;
    const popup = window.open(url, "youtube_oauth", "width=600,height=700");
    youtubePopupRef.current = popup;
  };

  const handlePublishYouTube = async (params: {
    title: string;
    description: string;
    tags: string[];
    privacy: "private" | "unlisted" | "public";
  }) => {
    if (!jobId) return;
    setYoutubePublishStage("publishing");
    setYoutubeErrorMsg("");
    try {
      const res = await fetch(`${BASE}/publish/youtube/${jobId}`, {
        method: "POST",
        headers: await getHeaders(),
        body: JSON.stringify(params),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      setYoutubeUrl(data.youtube_url);
      setYoutubePublishStage("published");
    } catch (e: unknown) {
      setYoutubePublishStage("error");
      setYoutubeErrorMsg(
        e instanceof Error ? e.message : "Publish failed. Please try again."
      );
    }
  };

  const handleYoutubeRetry = () => {
    setYoutubePublishStage("idle");
    setYoutubeErrorMsg("");
    setYoutubeUrl("");
  };

  // ─────────────────────────────────────────────────────────
  // Dead space handlers
  // ─────────────────────────────────────────────────────────

  // File selected → immediately POST /upload; idle until ready or error
  const handleFileSelect = useCallback(async (f: File) => {
    stopPolling();
    setFile(f);
    setJobId(null);
    setErrorMsg("");
    setStage("idle");
    setIsUploading(true);
    // reset respawn state for the new file
    setRespawnStage("idle");
    setRespawnStats(null);
    setRespawnErrorMsg("");
    // reset hype state for the new file
    setHypeStage("idle");
    setHypeMoments([]);
    setHypeErrorMsg("");
    // reset pipeline state for the new file
    stopPipelinePolling();
    setPipelineStage("idle");
    setPipelineCurrentStep(null);
    setPipelineStepsCompleted([]);
    setPipelinePercent(0);
    setPipelineSummary(null);
    setPipelineHasVideoOutput(false);
    setPipelineErrorMsg("");
    // reset YouTube publish state for new file (keep connection status)
    setYoutubePublishStage("idle");
    setYoutubeUrl("");
    setYoutubeErrorMsg("");
    setYoutubeConnectionChecked(false);

    try {
      const formData = new FormData();
      formData.append("file", f);
      if (activeTeamId) formData.append("team_id", activeTeamId);
      // No Content-Type — browser sets multipart boundary automatically
      const uploadHeaders = await getHeaders(false);
      const res = await fetch(`${BASE}/upload`, {
        method: "POST",
        headers: uploadHeaders,
        body: formData,
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res));
      }
      const { job_id } = await res.json();
      setJobId(job_id);
      setStage("ready");
      // Optimistically update the usage banner counter
      setBillingVideosUsed((prev) => prev + 1);
    } catch (e: unknown) {
      setStage("error");
      setErrorMsg(
        e instanceof Error ? e.message : "Something went wrong. Please try again."
      );
    } finally {
      setIsUploading(false);
    }
  }, []);

  // ready → processing
  const handleProcess = async () => {
    if (!jobId) return;
    setStage("processing");
    setErrorMsg("");

    try {
      const res = await fetch(`${BASE}/process/${jobId}`, {
        method: "POST",
        headers: await getHeaders(),
        body: JSON.stringify({
          threshold_db: thresholdDb,
          min_silence_duration: minSilenceDuration,
        }),
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res));
      }

      // Poll every 2 s: processing → done | error
      pollRef.current = setInterval(async () => {
        try {
          const statusHeaders = await getHeaders(false);
          const statusRes = await fetch(`${BASE}/status/${jobId}`, { headers: statusHeaders });
          if (!statusRes.ok) return;
          const { status, error } = await statusRes.json();
          if (status === "done") {
            stopPolling();
            setStage("done");
          } else if (status === "error") {
            stopPolling();
            setStage("error");
            setErrorMsg(error ?? "Something went wrong. Please try again.");
          }
        } catch {
          // network hiccup — keep polling
        }
      }, 2000);
    } catch (e: unknown) {
      stopPolling();
      setStage("error");
      setErrorMsg(
        e instanceof Error ? e.message : "Something went wrong. Please try again."
      );
    }
  };

  const handleDownload = async () => {
    if (!jobId) return;
    await downloadSigned(`${BASE}/download/${jobId}`);
  };

  // error → ready (job exists) | idle (upload failed)
  const handleTryAgain = () => {
    stopPolling();
    setErrorMsg("");
    if (jobId) {
      setStage("ready");
    } else {
      setFile(null);
      setStage("idle");
    }
  };

  // done → idle: full reset including settings back to defaults
  const handleReset = () => {
    stopPolling();
    setFile(null);
    setJobId(null);
    setStage("idle");
    setErrorMsg("");
    setThresholdDb(DEFAULT_THRESHOLD);
    setMinSilenceDuration(DEFAULT_DURATION);
    // reset respawn too
    setRespawnStage("idle");
    setRespawnStats(null);
    setRespawnErrorMsg("");
    setBlackThreshold(DEFAULT_BLACK_THRESHOLD);
    setRespawnMinDuration(DEFAULT_RESPAWN_MIN_DURATION);
    // reset hype too
    setHypeEnabled(false);
    setHypeStage("idle");
    setHypeMoments([]);
    setHypeErrorMsg("");
    setAudioSensitivity(DEFAULT_AUDIO_SENSITIVITY);
    setMotionSensitivity(DEFAULT_MOTION_SENSITIVITY);
    setMinGapSeconds(DEFAULT_MIN_GAP);
    // reset pipeline too
    stopPipelinePolling();
    setPipelineMode(false);
    setPipelineDeadSpaceEnabled(DEFAULT_PIPELINE_DEAD_SPACE_ENABLED);
    setPipelineRespawnEnabled(DEFAULT_PIPELINE_RESPAWN_ENABLED);
    setPipelineHypeEnabled(DEFAULT_PIPELINE_HYPE_ENABLED);
    setPipelineStage("idle");
    setPipelineCurrentStep(null);
    setPipelineStepsCompleted([]);
    setPipelinePercent(0);
    setPipelineSummary(null);
    setPipelineHasVideoOutput(false);
    setPipelineErrorMsg("");
    // reset YouTube too
    setYoutubePublishStage("idle");
    setYoutubeUrl("");
    setYoutubeErrorMsg("");
    setYoutubeConnectionChecked(false);
  };

  // ─────────────────────────────────────────────────────────
  // Respawn handlers
  // ─────────────────────────────────────────────────────────

  const handleRespawnProcess = async () => {
    if (!jobId) return;
    setRespawnStage("processing");
    setRespawnErrorMsg("");
    setRespawnStats(null);

    try {
      const res = await fetch(`${BASE}/process/respawn/${jobId}`, {
        method: "POST",
        headers: await getHeaders(),
        body: JSON.stringify({
          black_threshold: blackThreshold,
          min_duration: respawnMinDuration,
        }),
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res));
      }
      const data = await res.json();
      setRespawnStats({
        segments_removed: data.segments_removed,
        time_saved_seconds: data.time_saved_seconds,
      });
      setRespawnStage("done");
    } catch (e: unknown) {
      setRespawnStage("error");
      setRespawnErrorMsg(
        e instanceof Error ? e.message : "Something went wrong. Please try again."
      );
    }
  };

  const handleRespawnDownload = async () => {
    if (!jobId) return;
    await downloadSigned(`${BASE}/download/respawn/${jobId}`);
  };

  const handleRespawnRetry = () => {
    setRespawnStage("idle");
    setRespawnErrorMsg("");
    setRespawnStats(null);
  };

  // ─────────────────────────────────────────────────────────
  // Hype handlers
  // ─────────────────────────────────────────────────────────

  const handleHypeAnalyze = async () => {
    if (!jobId) return;
    setHypeStage("analyzing");
    setHypeErrorMsg("");
    setHypeMoments([]);

    try {
      const res = await fetch(`${BASE}/analyze/hype/${jobId}`, {
        method: "POST",
        headers: await getHeaders(),
        body: JSON.stringify({
          audio_sensitivity: audioSensitivity,
          motion_sensitivity: motionSensitivity,
          min_gap_seconds: minGapSeconds,
        }),
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res));
      }
      const data = await res.json();
      setHypeMoments(data.moments ?? []);
      setHypeStage("done");
    } catch (e: unknown) {
      setHypeStage("error");
      setHypeErrorMsg(
        e instanceof Error ? e.message : "Something went wrong. Please try again."
      );
    }
  };

  const handleHypeExport = async () => {
    if (!jobId) return;
    try {
      await downloadAuthed(`${BASE}/analyze/hype/${jobId}/export`, "hype_markers.xml");
    } catch {
      // silent — export failure doesn't change stage
    }
  };

  const handleHypeRetry = () => {
    setHypeStage("idle");
    setHypeErrorMsg("");
    setHypeMoments([]);
  };

  // ─────────────────────────────────────────────────────────
  // Pipeline handlers
  // ─────────────────────────────────────────────────────────

  const handlePipelineRun = async () => {
    if (!jobId) return;
    stopPipelinePolling();
    setPipelineStage("running");
    setPipelineErrorMsg("");
    setPipelineCurrentStep(null);
    setPipelineStepsCompleted([]);
    setPipelinePercent(0);
    setPipelineSummary(null);
    setPipelineHasVideoOutput(false);

    try {
      const res = await fetch(`${BASE}/process/pipeline/${jobId}`, {
        method: "POST",
        headers: await getHeaders(),
        body: JSON.stringify({
          dead_space: {
            enabled: pipelineDeadSpaceEnabled,
            threshold_db: thresholdDb,
            min_silence_duration: minSilenceDuration,
          },
          respawn_removal: {
            enabled: pipelineRespawnEnabled,
            black_threshold: blackThreshold,
            min_duration: respawnMinDuration,
          },
          hype_detection: {
            enabled: pipelineHypeEnabled,
            audio_sensitivity: audioSensitivity,
            motion_sensitivity: motionSensitivity,
            min_gap_seconds: minGapSeconds,
          },
        }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));

      // Poll pipeline status every 2s
      pipelinePollRef.current = setInterval(async () => {
        try {
          const pipelineStatusHeaders = await getHeaders(false);
          const statusRes = await fetch(`${BASE}/status/${jobId}/pipeline`, {
            headers: pipelineStatusHeaders,
          });
          if (!statusRes.ok) return;
          const data = await statusRes.json();
          setPipelineCurrentStep(data.current_step ?? null);
          setPipelineStepsCompleted(data.steps_completed ?? []);
          setPipelinePercent(data.percent ?? 0);
          if (data.status === "done") {
            stopPipelinePolling();
            setPipelineStage("done");
            setPipelineSummary(data.summary ?? null);
            setPipelineHasVideoOutput(data.has_video_output ?? false);
          } else if (data.status === "error") {
            stopPipelinePolling();
            setPipelineStage("error");
            setPipelineErrorMsg(
              data.error ?? "Pipeline failed. Try adjusting your settings and running again."
            );
          }
        } catch {
          // network hiccup — keep polling
        }
      }, 2000);
    } catch (e: unknown) {
      stopPipelinePolling();
      setPipelineStage("error");
      setPipelineErrorMsg(
        e instanceof Error ? e.message : "Something went wrong. Please try again."
      );
    }
  };

  const handlePipelineDownload = async () => {
    if (!jobId) return;
    await downloadSigned(`${BASE}/download/pipeline/${jobId}`);
  };

  const handlePipelineExportHype = async () => {
    if (!jobId) return;
    try {
      await downloadAuthed(`${BASE}/download/pipeline/${jobId}/hype`, "hype_markers.xml");
    } catch {
      // silent — export failure is non-critical
    }
  };

  const handlePipelineRetry = () => {
    stopPipelinePolling();
    setPipelineStage("idle");
    setPipelineCurrentStep(null);
    setPipelineStepsCompleted([]);
    setPipelinePercent(0);
    setPipelineSummary(null);
    setPipelineHasVideoOutput(false);
    setPipelineErrorMsg("");
  };

  // ─────────────────────────────────────────────────────────
  // Derived
  // ─────────────────────────────────────────────────────────

  const isWorking = isUploading || stage === "processing";
  const hasProcessedVideo =
    stage === "done" || pipelineStage === "done";
  const showPanels =
    stage === "ready" || stage === "processing" || stage === "done" || stage === "error";

  // ─────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────

  // Don't render until auth is confirmed — prevents flash of unauthenticated UI
  if (!isAuthChecked) return null;

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh" }}>
      <TopBar
        userEmail={userEmail}
        onSignOut={handleSignOut}
        teams={teams}
        activeTeamId={activeTeamId}
        billingPlan={billingPlan}
        onWorkspaceChange={handleWorkspaceChange}
        onCreateTeam={() => { setCreateTeamError(""); setShowCreateTeam(true); }}
      />

      {/* Create Team modal */}
      {showCreateTeam && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 200,
            padding: 24,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowCreateTeam(false); }}
        >
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              padding: "28px 28px 24px",
              width: "100%",
              maxWidth: 400,
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <h2
              style={{
                fontFamily: "'Space Mono', monospace",
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: "0.15em",
                color: "var(--text)",
                margin: 0,
              }}
            >
              CREATE TEAM
            </h2>
            <input
              autoFocus
              type="text"
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreateTeam(); }}
              placeholder="Team name"
              style={{
                padding: "9px 12px",
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
                color: "var(--text)",
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 14,
                outline: "none",
              }}
            />
            {createTeamError && (
              <p
                style={{
                  fontFamily: "'Space Mono', monospace",
                  fontSize: 10,
                  color: "var(--red)",
                  margin: 0,
                }}
              >
                {createTeamError}
              </p>
            )}
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={handleCreateTeam}
                disabled={creatingTeam || !newTeamName.trim()}
                style={{
                  flex: 1,
                  padding: "10px 0",
                  fontFamily: "'Space Mono', monospace",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  background: creatingTeam ? "var(--green-dim)" : "var(--green)",
                  color: creatingTeam ? "var(--green)" : "#000",
                  border: "none",
                  cursor: creatingTeam ? "not-allowed" : "pointer",
                }}
              >
                {creatingTeam ? "CREATING..." : "CREATE"}
              </button>
              <button
                onClick={() => setShowCreateTeam(false)}
                style={{
                  padding: "10px 18px",
                  fontFamily: "'Space Mono', monospace",
                  fontSize: 11,
                  letterSpacing: "0.08em",
                  background: "transparent",
                  border: "1px solid var(--border)",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                }}
              >
                CANCEL
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Usage banner — shown only on Free plan */}
      {billingPlan === "free" && billingLimit !== null && (
        <div
          style={{
            background: billingVideosUsed >= billingLimit ? "var(--red-dim)" : "var(--surface)",
            borderBottom: `1px solid ${billingVideosUsed >= billingLimit ? "var(--red-border)" : "var(--border)"}`,
            padding: "9px 20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
          }}
        >
          <span
            style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 13,
              color: billingVideosUsed >= billingLimit ? "var(--red)" : "var(--text-muted)",
            }}
          >
            {billingVideosUsed} of {billingLimit} free video{billingLimit !== 1 ? "s" : ""} used this month
            {billingVideosUsed >= billingLimit ? " — limit reached" : ""}
          </span>
          <a
            href="/billing"
            style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.1em",
              color: "var(--green)",
              textDecoration: "none",
              padding: "3px 8px",
              border: "1px solid var(--green-border)",
            }}
          >
            UPGRADE TO CREATOR →
          </a>
        </div>
      )}

      {/* Team workspace context banner */}
      {activeTeamId && (() => {
        const t = teams.find((x) => x.id === activeTeamId);
        return t ? (
          <div
            style={{
              background: "var(--green-dim)",
              borderBottom: "1px solid var(--green-border)",
              padding: "7px 20px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
            }}
          >
            <span
              style={{
                fontFamily: "'Space Mono', monospace",
                fontSize: 10,
                letterSpacing: "0.1em",
                color: "var(--green)",
              }}
            >
              WORKSPACE: {t.name.toUpperCase()}
            </span>
            {t.role === "owner" && (
              <a
                href={`/teams/${t.id}/settings`}
                style={{
                  fontFamily: "'Space Mono', monospace",
                  fontSize: 9,
                  color: "var(--text-dim)",
                  textDecoration: "none",
                  letterSpacing: "0.08em",
                }}
              >
                SETTINGS →
              </a>
            )}
          </div>
        ) : null;
      })()}

      <main className="flex flex-col items-center px-4 pt-10 pb-16">
      {/* Header */}
      <header className="mb-12 text-center">
        <div className="flex items-center justify-center gap-3 mb-3">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <circle cx="6" cy="6" r="3" stroke="var(--green)" strokeWidth="1.8" />
            <circle cx="6" cy="18" r="3" stroke="var(--green)" strokeWidth="1.8" />
            <path
              d="M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12"
              stroke="var(--green)"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
          <h1
            className="text-2xl font-bold tracking-[0.2em]"
            style={{ fontFamily: "'Space Mono', monospace", color: "var(--text)" }}
          >
            CLIPFORGE
          </h1>
        </div>
        <p
          className="text-sm"
          style={{ color: "var(--text-muted)", fontFamily: "'DM Sans', sans-serif" }}
        >
          Remove dead space &amp; silence from your videos automatically
        </p>
      </header>

      {/* Main column */}
      <div className="w-full flex flex-col gap-6" style={{ maxWidth: 680 }}>
        {/* Drop zone */}
        <DropZone
          file={file}
          isUploading={isUploading}
          onFileSelect={handleFileSelect}
          disabled={isWorking}
        />

        {showPanels && (
          <>
            {/* ── Full Pipeline card (always visible when panels are shown) ── */}
            <PipelinePanel
              pipelineMode={pipelineMode}
              onPipelineModeChange={(v) => {
                setPipelineMode(v);
                if (!v) stopPipelinePolling();
              }}
              deadSpaceEnabled={pipelineDeadSpaceEnabled}
              onDeadSpaceEnabledChange={setPipelineDeadSpaceEnabled}
              respawnEnabled={pipelineRespawnEnabled}
              onRespawnEnabledChange={setPipelineRespawnEnabled}
              hypeEnabled={pipelineHypeEnabled}
              onHypeEnabledChange={setPipelineHypeEnabled}
              thresholdDb={thresholdDb}
              onThresholdDbChange={setThresholdDb}
              minSilenceDuration={minSilenceDuration}
              onMinSilenceDurationChange={setMinSilenceDuration}
              blackThreshold={blackThreshold}
              onBlackThresholdChange={setBlackThreshold}
              respawnMinDuration={respawnMinDuration}
              onRespawnMinDurationChange={setRespawnMinDuration}
              audioSensitivity={audioSensitivity}
              onAudioSensitivityChange={setAudioSensitivity}
              motionSensitivity={motionSensitivity}
              onMotionSensitivityChange={setMotionSensitivity}
              minGapSeconds={minGapSeconds}
              onMinGapSecondsChange={setMinGapSeconds}
              stage={pipelineStage}
              currentStep={pipelineCurrentStep}
              stepsCompleted={pipelineStepsCompleted}
              percent={pipelinePercent}
              summary={pipelineSummary}
              errorMsg={pipelineErrorMsg}
              hasVideoOutput={pipelineHasVideoOutput}
              onRun={handlePipelineRun}
              onDownload={handlePipelineDownload}
              onExportHype={handlePipelineExportHype}
              onRetry={handlePipelineRetry}
              hasJob={jobId !== null}
              disabled={isWorking}
            />

            {/* ── Individual feature panels (hidden when pipeline mode is on) ── */}
            {!pipelineMode && (
              <>
            {/* ── Dead Space Removal card ── */}
            <SettingsPanel
              thresholdDb={thresholdDb}
              onThresholdDbChange={setThresholdDb}
              minSilenceDuration={minSilenceDuration}
              onMinSilenceDurationChange={setMinSilenceDuration}
              disabled={isWorking || stage === "done"}
            />

            <StatusBar stage={stage} errorMsg={errorMsg} />

            {stage === "done" && (
              <div className="flex flex-col gap-3">
                <button
                  onClick={handleDownload}
                  className="w-full py-3 px-6 font-bold text-sm transition-all"
                  style={{
                    fontFamily: "'Space Mono', monospace",
                    background: "var(--green)",
                    color: "#000",
                    border: "none",
                    cursor: "pointer",
                    letterSpacing: "0.05em",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = "0.85")}
                  onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
                >
                  DOWNLOAD PROCESSED VIDEO
                </button>
                <button
                  onClick={handleReset}
                  className="w-full py-3 px-6 font-bold text-sm transition-all"
                  style={{
                    fontFamily: "'Space Mono', monospace",
                    background: "transparent",
                    border: "1px solid #ffffff",
                    color: "#ffffff",
                    cursor: "pointer",
                    letterSpacing: "0.05em",
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = "#ffffff";
                    e.currentTarget.style.color = "#000000";
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.color = "#ffffff";
                  }}
                >
                  PROCESS ANOTHER VIDEO
                </button>
              </div>
            )}

            {stage === "error" && (
              <button
                onClick={handleTryAgain}
                className="w-full py-3 px-6 font-bold text-sm transition-all"
                style={{
                  fontFamily: "'Space Mono', monospace",
                  background: "transparent",
                  border: "1px solid #ff4444",
                  color: "#ff4444",
                  cursor: "pointer",
                  letterSpacing: "0.1em",
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = "#ff4444";
                  e.currentTarget.style.color = "#ffffff";
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "#ff4444";
                }}
              >
                TRY AGAIN
              </button>
            )}

            {stage === "ready" && (
              <button
                onClick={handleProcess}
                className="w-full py-3 px-6 font-bold text-sm transition-all"
                style={{
                  fontFamily: "'Space Mono', monospace",
                  background: "transparent",
                  border: "1px solid var(--green)",
                  color: "var(--green)",
                  cursor: "pointer",
                  letterSpacing: "0.1em",
                }}
                onMouseEnter={e => (e.currentTarget.style.background = "var(--green-dim)")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              >
                REMOVE DEAD SPACE
              </button>
            )}

            {/* ── Respawn Wait Remover card ── */}
            <RespawnPanel
              enabled={respawnEnabled}
              onEnabledChange={setRespawnEnabled}
              blackThreshold={blackThreshold}
              onBlackThresholdChange={setBlackThreshold}
              minDuration={respawnMinDuration}
              onMinDurationChange={setRespawnMinDuration}
              stage={respawnStage}
              stats={respawnStats}
              errorMsg={respawnErrorMsg}
              onProcess={handleRespawnProcess}
              onDownload={handleRespawnDownload}
              onRetry={handleRespawnRetry}
              hasJob={jobId !== null}
              disabled={isWorking || respawnStage === "processing"}
            />

            {/* ── Hype Moment Detector card ── */}
            <HypePanel
              enabled={hypeEnabled}
              onEnabledChange={setHypeEnabled}
              audioSensitivity={audioSensitivity}
              onAudioSensitivityChange={setAudioSensitivity}
              motionSensitivity={motionSensitivity}
              onMotionSensitivityChange={setMotionSensitivity}
              minGapSeconds={minGapSeconds}
              onMinGapSecondsChange={setMinGapSeconds}
              stage={hypeStage}
              moments={hypeMoments}
              errorMsg={hypeErrorMsg}
              onAnalyze={handleHypeAnalyze}
              onExport={handleHypeExport}
              onRetry={handleHypeRetry}
              hasJob={jobId !== null}
              disabled={isWorking || hypeStage === "analyzing"}
            />
              </>
            )}
          </>
        )}

        {/* ── YouTube Publish card (shown once any processing is complete) ── */}
        {hasProcessedVideo && (
          <YouTubePanel
            connected={youtubeConnected}
            connectionChecked={youtubeConnectionChecked}
            stage={youtubePublishStage}
            youtubeUrl={youtubeUrl}
            errorMsg={youtubeErrorMsg}
            defaultTitle={file?.name.replace(/\.[^.]+$/, "") ?? "My ClipForge Video"}
            onConnect={handleConnectYouTube}
            onPublish={handlePublishYouTube}
            onRetry={handleYoutubeRetry}
            disabled={isWorking}
          />
        )}
      </div>

      <footer
        className="mt-16 text-xs text-center"
        style={{ color: "#555555", fontFamily: "'DM Sans', sans-serif" }}
      >
        ClipForge &mdash; built for creators
      </footer>
      </main>
    </div>
  );
}
