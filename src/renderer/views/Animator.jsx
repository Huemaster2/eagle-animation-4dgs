import CameraSettingsWindow from '@components/CameraSettingsWindow';
import CameraTestWindow from '@components/CameraTestWindow';
import ControlBar from '@components/ControlBar';
import DesktopNavigation from '@components/DesktopNavigation';
import HistogramWindow from '@components/HistogramWindow';
import ImportOverlay from '@components/ImportOverlay';
import KeyboardHandler from '@components/KeyboardHandler';
import LimitWarning from '@components/LimitWarning';
import LoadingPage from '@components/LoadingPage';
import MagnifierWindow from '@components/MagnifierWindow';
import MaskingWindow from '@components/MaskingWindow';
import MobileNavigation from '@components/MobileNavigation';
import NoticeBanner from '@components/NoticeBanner';
import OnionSkinWindow from '@components/OnionSkinWindow';
import PageLayout from '@components/PageLayout';
import ParadeWindow from '@components/ParadeWindow';
import PerspectiveBar from '@components/PerspectiveBar';
import PictureWindow from '@components/PictureWindow';
import Player from '@components/Player';
import ReferenceSequencesPanel from '@components/ReferenceSequencesPanel';
import RotationCaptureProgress from '@components/RotationCaptureProgress';
import SceneSelector from '@components/SceneSelector';
import SceneSelectorWindow from '@components/SceneSelectorWindow';
import SceneSettingsWindow from '@components/SceneSettingsWindow';
import SequenceStrip from '@components/SequenceStrip';
import Timeline from '@components/Timeline';
import ToolsWindow from '@components/ToolsWindow';
import Tour from '@components/Tour';
import { tagFailure } from '@components/TurntableQuickControls';
import TurntableWindow from '@components/TurntableWindow';
import ViewsPanel from '@components/ViewsPanel';
import ViewTimelines from '@components/ViewTimelines';
import Window from '@components/Window';
import XSheet from '@components/XSheet';
import { DEFAULT_FPS, MAX_FRAME_DUPLICATION } from '@config-web';
import { angleGap, downscaleFrame, frameFolderName, nearestShot, nextSequenceNumber, planSequence, redoHeightError, runSequence, shotAngle, shotBaseName } from '@core/captureSequence';
import { selectionClick } from '@core/frameSelection';
import { normalizeOnionSkin } from '@core/onionSkin';
import { referenceMatchesPerspective } from '@core/perspectives';
import { parseRatio } from '@core/ratio';
import { getAnimationPosition, getReferenceFrame, normalizeReference } from '@core/referenceSequence';
import {
  getLastStopMoCaptureFiles,
  getStopMoCameraStatus,
  getStopMoCaptureOptions,
  setStopMoCaptureNaming,
  setStopMoCaptureOptions,
  setStopMoRawContext,
  STOPMO_CAMERA_AVAILABLE,
  stopmoGrabLiveFrame,
} from '@core/stopmoCamera';
import { alignTable, observeTags, turnToView } from '@core/tagVision';
import { turntable } from '@core/turntable';
import { angleOf, degreesToSteps, nearestEquivalent, PERSPECTIVES } from '@core/turntableMath';
import useAppCapabilities from '@hooks/useAppCapabilities';
import useCamera from '@hooks/useCamera';
import useDiscordActivity from '@hooks/useDiscordActivity';
import useProject from '@hooks/useProject';
import useSettings from '@hooks/useSettings';
import useTurntable from '@hooks/useTurntable';
import faArrowLeft from '@icons/faArrowLeft';
import faBoxArrowDown from '@icons/faBoxArrowDown';
import faBrightness from '@icons/faBrightness';
import faCamera from '@icons/faCamera';
import faCrosshairs from '@icons/faCrosshairs';
import faEllipsisVertical from '@icons/faEllipsisVertical';
import faEraser from '@icons/faEraser';
import faFaceViewfinder from '@icons/faFaceViewfinder';
import faFolder from '@icons/faFolder';
import faImage from '@icons/faImage';
import faImages from '@icons/faImages';
import faMagnifyingGlass from '@icons/faMagnifyingGlass';
import faPlay from '@icons/faPlay';
import faRotate from '@icons/faRotate';
import faSignal from '@icons/faSignal';
import faSliders from '@icons/faSliders';
import faStop from '@icons/faStop';
import faWaveform from '@icons/faWaveform';
import faXSheet from '@icons/faXSheet';
import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { withTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';

import soundDelete from '~/resources/sounds/delete.mp3';
import soundDeleteConfirm from '~/resources/sounds/deleteConfirm.mp3';
import soundEagle from '~/resources/sounds/eagle.mp3';
import soundError from '~/resources/sounds/error.mp3';
import soundShutter from '~/resources/sounds/shutter.mp3';

const MASKING_MODES = {
  DISABLED: (t) => t('Disabled'),
  UNIQUE: (t) => t('Unique'),
  CONTINUOUS: (t) => t('Continuous'),
};

// Play sound
const playSound = (src, timeout = 2000) => {
  const e = document.createElement('audio');
  let clock = null;
  e.onended = function () {
    if (e) {
      e.remove();
    }
    clearTimeout(clock);
  };
  e.src = src;
  document.body.appendChild(e);
  e.play();
  clock = setTimeout(() => {
    if (e) {
      e.remove();
    }
  }, timeout);
};

// Get previous frame id
const getPreviousFrameId = (frames, frameId, skipHiddenFrames = false) => {
  let frameFound = false;
  for (const frame of frames.toReversed()) {
    if (frame.deleted) {
      continue;
    }

    const isShowable = !frame?.hidden || (!skipHiddenFrames && !!frame?.hidden);

    // Live view case, return the first showable frame
    if (frameId === false && isShowable) {
      return frame.id;
    }

    // Frame found, the next showable frame we find will be returned
    if (frame.id === frameId) {
      frameFound = true;
      continue;
    }

    // Return the current showable frame
    if (frameFound && isShowable) {
      return frame.id;
    }
  }

  // Fallback, return the initial frameId
  return frameId;
};

// Get last frame id
const getLastFrameId = (frames) => getPreviousFrameId(frames, false);

// Get next frame id
const getNextFrameId = (frames, frameId, skipHiddenFrames = false) => {
  let frameFound = false;
  for (const frame of frames) {
    if (frame.deleted) {
      continue;
    }

    const isShowable = !frame?.hidden || (!skipHiddenFrames && !!frame?.hidden);

    // Frame found, the next showable frame we find will be returned
    if (frame.id === frameId) {
      frameFound = true;
      continue;
    }

    // Return the current showable frame
    if (frameFound && isShowable) {
      return frame.id;
    }
  }

  // Fallback, return to the live view
  return false;
};

// Get first frame id
const getFirstFrameId = (list) => {
  const frames = list.filter((pict) => !pict.deleted);
  if (frames.length) {
    return frames[0].id;
  }
  return false;
};

// The camera dials shown beside the viewer
const EXPOSURE_CAPABILITIES = ['shutter_speed', 'aperture', 'iso'];

const Animator = ({ t }) => {
  const { id, track } = useParams();
  const navigate = useNavigate();
  const playerRef = useRef(null);
  const getLiveCanvas = useCallback(() => playerRef.current?.getLiveCanvas?.() || null, []);
  const [magnifierCenter, setMagnifierCenter] = useState(null);
  const [magnifierAspect, setMagnifierAspect] = useState(0.75);

  const [startedAt, setStartedAt] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const { settings, actions: settingsActions } = useSettings();
  const { appCapabilities } = useAppCapabilities();
  const [activeWindow, setActiveWindow] = useState(null);
  const [maskingMode, setMaskingMode] = useState('DISABLED');
  const [isTakingPicture, setIsTakingPicture] = useState(false);
  const [loopStatus, setLoopStatus] = useState(false);
  const [shortPlayStatus, setShortPlayStatus] = useState(false);
  const [differenceStatus, setDifferenceStatus] = useState(false);
  const [onionValue, setOnionValue] = useState(1);
  const [referenceFrameId, setReferenceFrameId] = useState(null);
  const [referenceImport, setReferenceImport] = useState(null);
  const [canonStatus, setCanonStatus] = useState(null);
  const [activePerspective, setActivePerspective] = useState(null);
  const [perspectiveStatus, setPerspectiveStatus] = useState('');
  const [notice, setNotice] = useState(null);
  const [rotationRun, setRotationRun] = useState(null);
  const [expandedFrameId, setExpandedFrameId] = useState(null);
  // X-sheet selection and the frames queued to be replaced by the next captures
  const [frameSelection, setFrameSelection] = useState({ selected: [], anchor: null });
  const [replaceQueue, setReplaceQueue] = useState([]);
  // Rotation photo shown in place of a frame's timeline photo: { frameId, filename }
  const [shotPreview, setShotPreview] = useState(null);
  const rotationControl = useRef({ stop: false, continueHeight: null });
  // Height the camera was last left at by a rotation capture (null until the first one: the app asks)
  const cameraHeightRef = useRef(null);
  const { state: turntableState, profile: turntableProfile, actions: turntableActions } = useTurntable();

  // The Arduino forgets its position on reset, so every stop is remembered in the rig profile
  const updateTurntableProfile = useRef(turntableActions.updateProfile);
  updateTurntableProfile.current = turntableActions.updateProfile;
  useEffect(() => turntable.onArrival((position) => updateTurntableProfile.current({ lastPosition: position })), []);

  // Clear camera connection indicator in the top bar
  useEffect(() => {
    if (!STOPMO_CAMERA_AVAILABLE) return undefined;
    let alive = true;
    const poll = () =>
      getStopMoCameraStatus()
        .then((s) => alive && setCanonStatus(s))
        .catch(() => null);
    poll();
    const timer = setInterval(poll, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  const [gridStatus, setGridStatus] = useState(false);
  const [currentFrameId, setCurrentFrameId] = useState(false);
  const [deleteOnLiveViewConfirmation, setDeleteOnLiveViewConfirmation] = useState(false);
  const [pendingBackgroundFrame, setPendingBackgroundFrame] = useState(false);
  const [sceneEditingIndex, setSceneEditingIndex] = useState(Number(track) || 0);
  const maskingEditorRef = useRef(null);

  const { project, actions: projectActions } = useProject({ id });

  // Where (and whether) ordinary captures keep the camera originals
  useEffect(() => {
    setStopMoRawContext(id, track, project?.title || '');
  }, [id, track, project?.title]);
  useEffect(() => {
    setStopMoCaptureOptions({ saveTarget: settings?.STOPMO_SAVE_TARGET, storageFolder: settings?.STOPMO_STORAGE_FOLDER });
  }, [settings?.STOPMO_SAVE_TARGET, settings?.STOPMO_STORAGE_FOLDER]);

  const nbFrames = project?.scenes?.[track]?.pictures?.filter((e) => !e.deleted)?.length || 0;
  const fps = Math.min(60, Math.max(1, Number(project?.scenes?.[track]?.framerate) || 1));
  const ratio = project?.scenes?.[track]?.ratio ? parseRatio(project?.scenes?.[track]?.ratio) : null;

  useDiscordActivity({
    actionIcon: 'animating',
    actionTitle: project?.title || null,
    description:
      nbFrames === 0
        ? t('Capture in progress')
        : t('Captured: {{content}}', {
            content: [t('{{count}} frame', { count: nbFrames })].join(' • '),
          }),
  });

  const { isCameraReady, devices, currentCameraCapabilities, currentCamera, currentCameraId, actions: cameraActions } = useCamera({ compatibilityMode: !!settings?.TOUCAN_CAMERA_SERVER_DISABLED });

  // Redirect to first available scene if current scene no longer exists (e.g. after undo or scene deletion)
  useEffect(() => {
    if (!project) return;
    const currentScene = project.scenes?.[track];
    if (!currentScene || currentScene.deleted) {
      const firstValid = project.scenes.findIndex((s) => !s.deleted);
      if (firstValid !== -1) {
        navigate(`/animator/${id}/${firstValid}`);
      }
    }
  }, [project, track, id, navigate]);

  // Disable frame deletion confirmation if we change the current frame
  useEffect(() => {
    (() => {
      setDeleteOnLiveViewConfirmation(false);
    })();
  }, [currentFrameId]);

  // Reset per-scene local state when switching scenes
  useEffect(() => {
    setCurrentFrameId(false);
    setReferenceFrameId(null);
    setPendingBackgroundFrame(false);
    setDeleteOnLiveViewConfirmation(false);
    if (playerRef.current) {
      playerRef.current.showFrame(false);
    }
  }, [track]);

  // Select default camera
  useEffect(() => {
    if (!devices?.length || !settings) {
      return;
    }

    const availableDevices = devices.filter((device) => !!device?.id);
    const currentIsValid = currentCameraId && availableDevices.some((device) => device.id === currentCameraId);
    if (currentIsValid) {
      return;
    }

    const savedCamera = availableDevices.find((device) => device.id === settings.CAMERA_ID);
    const defaultCamera = savedCamera || availableDevices[0] || null;
    if (!defaultCamera) {
      return;
    }

    cameraActions.setCamera(defaultCamera.id);

    // Only persist when we had to fall back to a different camera than the saved one,
    // so we don't overwrite a still-valid CAMERA_ID during transient device list updates
    // (e.g. compatibility mode toggle, slow device enumeration).
    if (!savedCamera) {
      settingsActions.setSettings({ CAMERA_ID: defaultCamera.id });
    }
  }, [devices, settings, currentCameraId]);

  const handleImportPicture = useCallback((blob) => projectActions.addFrame(track, blob), [projectActions, track]);

  const [alignReferenceId, setAlignReferenceId] = useState(null);
  const [alignDraft, setAlignDraft] = useState(null);
  // A position in the reference track that is past the shot frames; cleared as soon as a frame is picked
  const [referenceSeek, setReferenceSeek] = useState(null);

  const handleSelectFrame = useCallback((selectedFrameId) => {
    setReferenceSeek(null);
    playerRef.current.showFrame(selectedFrameId === false ? false : selectedFrameId);
  }, []);
  const playerSetStream = useRef(null);

  // Shortcut if informations are not ready
  if (!project || !settings || !devices) {
    return (
      <>
        <LoadingPage show={true} />
      </>
    );
  }

  // ---- RUNTIME LOGIC
  const pictures = (project.scenes[track]?.pictures || []).filter((e) => !e.deleted);
  const framePosition = currentFrameId === false ? false : pictures.findIndex((p) => p.id === currentFrameId) + 1 || 1;
  const onionConfig = normalizeOnionSkin(settings?.ONION_SKIN);
  const onionEnabled = onionConfig.ENABLED;
  const referenceFramePosition = referenceFrameId === null ? null : pictures.findIndex((p) => p.id === referenceFrameId) + 1 || null;
  const currentFrame = currentFrameId === false ? false : pictures.find((p) => p.id === currentFrameId) || false;
  const sceneReferences = project.scenes[track]?.references || [];
  // While a reference is being dragged its new place is kept here, and written once the drag ends
  const playerReferences = alignDraft && alignReferenceId ? sceneReferences.map((r) => (r.id === alignReferenceId ? { ...r, ...alignDraft } : r)) : sceneReferences;
  const alignReference = alignReferenceId ? normalizeReference(playerReferences.find((r) => r.id === alignReferenceId) || {}) : null;
  const referenceLength = Math.max(0, ...sceneReferences.filter((r) => r.enabled !== false).map((r) => (r.frames || []).length));
  const referencesHidden = !!settings.REFERENCES_HIDDEN;
  // Frames with a rotation play from the active view: each shows its photo nearest that view's angle
  const viewSteps = activePerspective ? turntableProfile.perspectives[activePerspective] : null;
  const viewAngle = viewSteps === null || viewSteps === undefined ? null : angleOf(viewSteps, turntableState.stepsPerRev);
  const viewPictures = pictures.map((p) => {
    if (!p.sequence || viewAngle === null) return p;
    const shot = nearestShot(p.sequence, viewAngle);
    if (!shot?.link) return p;
    // The timeline frame carries the angle it is showing, and whether the turn ever reached this view
    const spacing = 360 / (2 * Math.max(1, p.sequence?.shotsPerPass || 1));
    return { ...p, link: shot.link, shotAngle: shot.angle, shotOff: angleGap(shot.angle, viewAngle) > spacing + 0.5 };
  });
  const playerPictures = shotPreview
    ? viewPictures.map((p) => {
        if (p.id !== shotPreview.frameId) return p;
        const shot = p.sequence?.shots?.find((sh) => sh.filename === shotPreview.filename);
        return shot?.link ? { ...p, link: shot.link } : p;
      })
    : viewPictures;
  // The reference runs as a second row of the timeline: frame 1 beside frame 1, carrying on past the last shot
  const trackReference = referencesHidden ? null : sceneReferences.map(normalizeReference).find((r) => r.enabled && r.frames.length && referenceMatchesPerspective(r, activePerspective));
  const referenceCells = (() => {
    if (!trackReference) return null;
    const shown = viewPictures.filter((p) => !p.deleted);
    const current = Number.isFinite(referenceSeek) ? referenceSeek : null;
    const cells = [];
    let position = 0;
    for (const p of shown) {
      const found = getReferenceFrame(trackReference, position);
      cells.push({ id: p.id, position, link: found?.frame?.link || null, current: current === position });
      if (!p.hidden) position += p.length || 1;
    }
    const extra = [];
    for (let i = position; i < trackReference.frames.length - (trackReference.offset || 0); i++) {
      const found = getReferenceFrame(trackReference, i);
      if (found?.frame?.link) extra.push({ position: i, link: found.frame.link, current: current === i });
    }
    return cells.length || extra.length ? { cells, extra } : null;
  })();
  const expandedFrame = expandedFrameId ? pictures.find((p) => p.id === expandedFrameId) || null : null;
  const expandedFrames = pictures.reduce((acc, e) => [...acc, ...new Array(e.length || 1).fill(e)], []);
  const animationPosition = getAnimationPosition(
    expandedFrames,
    currentFrameId === false
      ? false
      : Math.max(
          0,
          expandedFrames.findIndex((p) => p.id === currentFrameId)
        )
  );
  // The view buttons appear once the rig has views set up or a reference sequence is tied to a view
  const showPerspectives = STOPMO_CAMERA_AVAILABLE && (turntableState.connected || PERSPECTIVES.some((v) => turntableProfile.perspectives[v] !== null) || sceneReferences.some((r) => r.perspective));
  // Looking at captured frames rather than the live view: the views then only change which photo is shown
  const reviewingFrames = currentFrameId !== false || isPlaying;
  const rotationFrameCount = pictures.filter((p) => p.sequence?.shots?.length).length;
  const activeViewSteps = activePerspective ? turntableProfile.perspectives[activePerspective] : null;
  const tableAtActiveView =
    activeViewSteps === null || activeViewSteps === undefined || !turntableState.connected
      ? true
      : Math.abs(nearestEquivalent(activeViewSteps, turntableState.position ?? activeViewSteps, turntableState.stepsPerRev) - (turntableState.position ?? 0)) <= 2;
  // One timeline per calibrated view: every frame's photo taken at that view's angle
  const viewRows = PERSPECTIVES.map((view) => ({ view, steps: turntableProfile.perspectives[view] }))
    .filter(({ steps }) => steps !== null && steps !== undefined)
    .map(({ view, steps }) => {
      const angle = angleOf(steps, turntableState.stepsPerRev);
      return {
        view,
        angle,
        frames: pictures.map((p) => {
          const shot = p.sequence ? nearestShot(p.sequence, angle) : null;
          // A turn that stopped early has no photo near some views: the nearest one is shown, marked as off-angle
          const spacing = 360 / (2 * Math.max(1, p.sequence?.shotsPerPass || 1));
          const gap = shot ? angleGap(shot.angle, angle) : null;
          return { id: p.id, link: shot?.link || p.link, angle: shot ? shot.angle : null, own: !shot?.link, off: gap !== null && gap > spacing + 0.5 };
        }),
      };
    });
  const perspectiveHint = () => {
    if (!activePerspective || !reviewingFrames) return perspectiveStatus;
    if (viewAngle === null) return t('{{view}} is not set on the turntable, so the frames cannot follow it', { view: t(activePerspective) });
    if (!rotationFrameCount) return t('No frame has a full turn yet, so every view shows the same photos');
    return t('{{n}} of {{total}} frames have a full turn and follow this view', { n: rotationFrameCount, total: pictures.length });
  };
  const totalAnimationFrames = pictures.reduce((acc, e) => acc + (!e.deleted && !e.hidden ? e.length || 1 : 0), 0);

  const visibleScenes = project.scenes.map((s, index) => ({ ...s, index })).filter((s) => !s.deleted);
  const editingScene = project.scenes[sceneEditingIndex] || null;
  const editingFps = Math.min(60, Math.max(1, Number(editingScene?.framerate) || 1));
  const editingRatio = editingScene?.ratio ? parseRatio(editingScene.ratio) : null;

  const handleAction = (action, args = null) => {
    if (actionsEvents[action]) {
      actionsEvents[action](args);
    } else {
      console.log('💥 Unsupported event', action, args);
    }
  };

  const handleSettingsChange = async (values) => {
    if (values.CAMERA_ID !== currentCameraId) {
      cameraActions.setCamera(values.CAMERA_ID || null);
    }
    settingsActions.setSettings(values);
  };

  const handleFrameMove = async (e) => {
    if (e.oldIndex === e.newIndex) {
      return;
    }

    const frameId = pictures[e.oldIndex].id;
    const beforeFrame = pictures?.[e.newIndex - (e.newIndex > e.oldIndex ? -1 : 0)]?.id;

    projectActions.moveFrame(track, frameId, beforeFrame);
    playerRef.current.showFrame(frameId);
    window.track('frame_moved', { projectId: `${id}`, trackId: `${track}`, frameId: `${frameId}` });
  };

  const rotationEnabled = turntableState.connected && turntableProfile.rotationCapture;

  // Shutter with rotation capture on: a full turn of photos at every camera height, saved as one timeline frame.
  // `reshoot` ({ frame, height }) re-shoots one height of a frame already taken, leaving its other heights alone.
  const runRotationCapture = async (replaceId = null, reshoot = null) => {
    const profile = turntableProfile;
    const rev = turntable.state.stepsPerRev;
    const old = reshoot?.frame?.sequence || null;
    const heights = old ? old.heights : profile.heights;
    const heroHeight = old ? old.heroHeight : Math.min(profile.heroHeight, heights);
    const shotsPerPass = old ? old.shotsPerPass : profile.shotsPerPass;
    const startView = old ? old.startView : PERSPECTIVES.includes(profile.rotationStart) && profile.perspectives[profile.rotationStart] !== null ? profile.rotationStart : null;
    const current = turntable.state.position ?? 0;
    // A re-shot height repeats its own first angle; a new frame starts from the chosen view (or where the table stands)
    const firstShot = old ? (old.shots || []).filter((sh) => sh.height === reshoot.height).sort((a, b) => a.index - b.index)[0] : null;
    const anchor = firstShot ? degreesToSteps(firstShot.angle, rev) : startView ? profile.perspectives[startView] : current;
    // Exact (unrounded) start on the revolution nearest the table, so rounding never drifts frame to frame
    const start = anchor + Math.round((current - anchor) / rev) * rev;
    const plan = reshoot
      ? planSequence({ start, stepsPerRev: rev, shotsPerPass, heights: 1 })
      : planSequence({ start, stepsPerRev: rev, shotsPerPass, heights, currentHeight: cameraHeightRef.current, serpentine: profile.alternateHeights });
    // The single pass of a re-shoot keeps the height number it replaces, so the photos keep their names
    if (reshoot) {
      plan.passes.forEach((pass) => {
        pass.height = reshoot.height;
        pass.shots.forEach((sh) => {
          sh.height = reshoot.height;
        });
      });
    }
    const number = old ? old.number : nextSequenceNumber(pictures);
    const folder = old ? old.folder : frameFolderName(number);
    const saveTarget = old ? old.saveTarget : STOPMO_CAMERA_AVAILABLE ? getStopMoCaptureOptions().saveTarget : 'mac';
    const shots = [];
    let heroFrame = null;
    let firstFrame = null;
    let failure = null;
    const tagsOn = STOPMO_CAMERA_AVAILABLE && !!profile.tags?.enabled;
    const rotationRefs = { ...profile.rotationRefs };
    const passRefs = {};
    const closures = [];
    let shotStarted = Date.now();
    const shotTimes = [];
    rotationControl.current = { stop: false, paused: false, resume: null, continueHeight: null, retryShot: null, retryMove: null, redo: false };
    const show = (patch) => setRotationRun((r) => ({ ...(r || {}), heights, shotsPerPass, reshooting: reshoot ? reshoot.height : null, folder: saveTarget === 'card' ? null : folder, ...patch }));
    show({ phase: 'starting', done: 0, total: plan.total });

    const key = turntable.lock();
    // A move that goes unanswered holds the run instead of ending it: the table has not turned, so it can be re-sent
    const moveWithRetry = async (steps) => {
      for (;;) {
        if (turntable.state.position === steps) return steps;
        try {
          return await turntable.moveTo(steps, { key });
        } catch (err) {
          if (rotationControl.current.stop) throw err;
          if (settings.SOUNDS) playSound(soundError);
          const again = await new Promise((resolve) => {
            rotationControl.current.retryMove = resolve;
            show({ phase: 'moveFailed', error: err?.message || `${err}` });
          });
          rotationControl.current.retryMove = null;
          if (again === 'redo') throw redoHeightError();
          if (!again) throw err;
          show({ phase: 'moving', error: null });
        }
      }
    };
    let result = null;
    try {
      // Turn to the start view first; the photos then follow the plan
      await moveWithRetry(Math.round(start));
      result = await runSequence({
        plan,
        shots,
        settleMs: profile.settleMs,
        needsFirstHeight: !!reshoot || cameraHeightRef.current !== plan.passes[0].height,
        moveTo: moveWithRetry,
        settle: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        isStopped: () => rotationControl.current.stop,
        onProgress: (progress) => {
          if (progress.phase === 'moving') {
            cameraHeightRef.current = progress.height;
            shotStarted = Date.now();
          }
          show(progress);
        },
        // With tag alignment on, every height starts where the rotations before it started, and its full turn
        // is closed by eye: the tags are brought back to where they were at the first photo
        onPassStart: async (pass, steps) => {
          if (!tagsOn) return;
          show({ phase: 'aligning', height: pass.height });
          const refKey = startView ? `${startView}:${pass.height}` : null;
          const stored = refKey ? rotationRefs[refKey] : null;
          if (stored?.tags?.length)
            await alignTable({ reference: stored, family: profile.tags.family, steps, key, isStopped: () => rotationControl.current.stop, label: `Height ${pass.height} start` });
          const seen = await observeTags({ family: profile.tags.family }).catch(() => null);
          passRefs[pass.height] = seen?.tags?.length ? seen : null;
          if (!passRefs[pass.height]) turntable.log(`Height ${pass.height}: no AprilTag in the live view, so this turn is not checked`);
          if (passRefs[pass.height] && refKey && !stored) {
            rotationRefs[refKey] = seen;
            updateTurntableProfile.current({ rotationRefs: { ...rotationRefs } });
          }
        },
        onPassEnd: async (pass, steps) => {
          if (!tagsOn) return;
          const reference = passRefs[pass.height];
          if (!reference) {
            closures.push({ height: pass.height, missing: true });
            return;
          }
          show({ phase: 'closing', height: pass.height });
          refreshLiveView();
          const result = await alignTable({ reference, family: profile.tags.family, steps, key, isStopped: () => rotationControl.current.stop, label: `Height ${pass.height} end` });
          closures.push({ height: pass.height, ...result });
        },
        askHeight: (height, isFirst) => {
          // The camera is about to be handled: live view has to be running to frame and focus by
          refreshLiveView();
          return new Promise((resolve) => {
            rotationControl.current.continueHeight = resolve;
            show({ phase: 'height', height, isFirst: isFirst && !reshoot });
          });
        },
        redoRequested: () => rotationControl.current.redo,
        redoDone: () => {
          rotationControl.current.redo = false;
        },
        // Pause holds the turn between photos: the table keeps its angle until Resume
        gate: async (shot) => {
          if (!rotationControl.current.paused || rotationControl.current.stop) return;
          refreshLiveView();
          await new Promise((resolve) => {
            rotationControl.current.resume = resolve;
            show({ phase: 'paused', height: shot.height, index: shot.index, pausing: false });
          });
          rotationControl.current.resume = null;
          rotationControl.current.paused = false;
        },
        capture: async (shot) => {
          let frame;
          // A failed photo pauses the turn: retry it in place, or stop and keep what was taken
          for (;;) {
            setStopMoCaptureNaming({ subDir: folder, baseName: shotBaseName(shot.height, shot.index) });
            try {
              frame = await cameraActions.takePicture(1, settings.REVERSE_X, settings.REVERSE_Y);
              break;
            } catch (err) {
              if (settings.SOUNDS) playSound(soundError);
              const retry = await new Promise((resolve) => {
                rotationControl.current.retryShot = resolve;
                show({ phase: 'failed', height: shot.height, index: shot.index, error: err?.message || `${err}` });
              });
              rotationControl.current.retryShot = null;
              if (retry === 'redo') throw redoHeightError();
              if (!retry) throw err;
              show({ phase: 'shooting', height: shot.height, index: shot.index, error: null });
            } finally {
              setStopMoCaptureNaming(null);
            }
          }
          if (settings.SOUNDS) playSound(soundShutter);
          const files = STOPMO_CAMERA_AVAILABLE ? getLastStopMoCaptureFiles().map((f) => ({ path: f.path, kind: f.kind, onCard: !!f.onCard })) : [];
          if (!firstFrame) firstFrame = frame;
          if (shot.height === heroHeight && shot.index === 0) heroFrame = frame;
          const saved = await projectActions.savePicture(track, await downscaleFrame(frame));
          // Turn, pause and photo together: what one photo of this run really costs
          shotTimes.push(Date.now() - shotStarted);
          show({ perPhoto: shotTimes.reduce((a, b) => a + b, 0) / shotTimes.length });
          return { height: shot.height, index: shot.index, angle: shotAngle(shot.steps, rev), offset: shot.offset, filename: saved.filename, link: saved.link, files };
        },
      });
    } catch (err) {
      failure = err;
    } finally {
      turntable.unlock(key);
      rotationControl.current.continueHeight = null;
      rotationControl.current.resume = null;
    }

    if (shots.length) {
      show({ phase: 'saving' });
      // A re-shoot keeps the frame's other heights and swaps in the new photos of this one
      const merged = reshoot ? [...(old.shots || []).filter((sh) => sh.height !== reshoot.height), ...shots] : shots;
      const sequence = {
        number,
        folder,
        saveTarget,
        shotsPerPass,
        heights,
        heroHeight,
        startView,
        complete: reshoot ? !!old.complete && !!result?.complete : !!result?.complete,
        shots: merged,
      };
      try {
        const extra = { ...(startView ? { perspective: startView } : {}), sequence };
        if (reshoot && reshoot.height !== heroHeight) {
          await projectActions.setFrameSequence(track, reshoot.frame.id, sequence);
        } else if (reshoot) {
          // The hero height is the photo the timeline shows, so that one is replaced as well
          await projectActions.replaceFrame(track, reshoot.frame.id, heroFrame || firstFrame, extra);
        } else if (replaceId) {
          await projectActions.replaceFrame(track, replaceId, heroFrame || firstFrame, extra);
          setReplaceQueue((q) => q.filter((id) => id !== replaceId));
        } else {
          await projectActions.addFrame(track, heroFrame || firstFrame, isPlaying ? false : currentFrameId, null, extra);
        }
      } catch (err) {
        failure = failure || err;
      }
    }
    setRotationRun(null);
    if (failure) {
      if (settings.SOUNDS) playSound(soundError);
      console.error('Rotation capture failed', failure);
      setNotice({ tone: 'error', message: t('Rotation capture stopped after {{n}} of {{total}} photos: {{error}}', { n: shots.length, total: plan.total, error: failure?.message || failure }) });
    } else if (!result?.complete) {
      setNotice({ tone: 'warning', message: t('Rotation capture stopped: {{n}} of {{total}} photos kept as frame {{folder}}.', { n: shots.length, total: plan.total, folder }) });
    } else if (closures.length) {
      // What the tags found at the end of each turn: how far the motor had left the table from a full circle
      const degrees = (n) => `${Math.abs((n * 360) / rev).toFixed(1)}°`;
      const lines = closures.map((c) => {
        if (c.missing) return t('height {{h}}: no tag in view, not checked', { h: c.height });
        if (!c.converged) return t('height {{h}}: tags could not be matched ({{why}})', { h: c.height, why: tagFailure(t, c) });
        if (c.moved === 0) return t('height {{h}}: back on the tags', { h: c.height });
        return t('height {{h}}: the turn ended {{deg}} {{side}} and was corrected', { h: c.height, deg: degrees(c.moved), side: c.moved > 0 ? t('short') : t('past') });
      });
      setNotice({ tone: closures.every((c) => c.converged) ? 'info' : 'warning', message: `${t('Tag check after each full turn')} — ${lines.join('; ')}.` });
    } else if (reshoot) {
      // The originals of the replaced photos stay on disk: nothing captured is ever written over
      setNotice({
        tone: 'info',
        message: t('Height {{h}} re-shot: {{n}} photos replace the earlier ones, which are still in {{folder}}.', { h: reshoot.height, n: shots.length, folder: folder || t('the camera card') }),
      });
    } else {
      setNotice(null);
    }
  };

  const continueRotation = () => rotationControl.current.continueHeight?.(true);
  const retryRotationShot = () => rotationControl.current.retryShot?.(true);
  const retryRotationMove = () => rotationControl.current.retryMove?.(true);
  // Starts this height over: its photos so far are dropped and the table carries on forwards to the same angles
  const redoRotationHeight = () => {
    rotationControl.current.redo = true;
    rotationControl.current.paused = false;
    setRotationRun((r) => (r ? { ...r, pausing: false, error: null } : r));
    rotationControl.current.retryShot?.('redo');
    rotationControl.current.retryMove?.('redo');
    rotationControl.current.resume?.();
  };
  const pauseRotation = () => {
    rotationControl.current.paused = true;
    setRotationRun((r) => (r ? { ...r, pausing: true } : r));
  };
  const resumeRotation = () => {
    rotationControl.current.paused = false;
    setRotationRun((r) => (r ? { ...r, pausing: false } : r));
    rotationControl.current.resume?.();
  };
  const stopRotation = () => {
    rotationControl.current.stop = true;
    rotationControl.current.paused = false;
    if (rotationControl.current.continueHeight) rotationControl.current.continueHeight(false);
    if (rotationControl.current.retryShot) rotationControl.current.retryShot(false);
    if (rotationControl.current.retryMove) rotationControl.current.retryMove(false);
    if (rotationControl.current.resume) rotationControl.current.resume();
    setRotationRun((r) => (r ? { ...r, stopping: true } : r));
  };

  const takePictures =
    (nbPicturesToTake = null) =>
    async () => {
      // During a rotation capture the shutter key means "camera is in place, carry on"
      if (rotationRun?.phase === 'height') {
        continueRotation();
        return;
      }
      if (rotationRun?.phase === 'paused') {
        resumeRotation();
        return;
      }
      if (isTakingPicture || !currentCamera) {
        return;
      }
      // A photo taken while the table turns would be blurred and at an unknown angle
      if (turntable.state.moving) {
        setNotice({ tone: 'warning', message: t('The turntable is moving — wait until it stops before taking a picture.') });
        return;
      }
      flushSync(() => {
        setIsTakingPicture(true);
      });

      setStartedAt((oldValue) => (oldValue ? oldValue : new Date().getTime() / 1000));

      if (rotationEnabled && maskingMode === 'DISABLED') {
        try {
          await runRotationCapture(replaceQueue.find((id) => pictures.some((p) => p.id === id)) || null);
        } finally {
          flushSync(() => {
            setIsTakingPicture(false);
          });
        }
        return;
      }

      const numberOfFramesToTake = Number(nbPicturesToTake !== null ? nbPicturesToTake : settings.CAPTURE_FRAMES) || 1;
      for (let i = 0; i < numberOfFramesToTake; i++) {
        const nbFramesToTakeForAvg = (settings.AVERAGING_ENABLED ? Number(settings.AVERAGING_VALUE) : 1) || 1;
        try {
          const frame = await cameraActions.takePicture(nbFramesToTakeForAvg, settings.REVERSE_X, settings.REVERSE_Y);
          const frameType = maskingMode === 'DISABLED' ? 'NORMAL' : pendingBackgroundFrame ? 'FOREGROUND' : 'BACKGROUND';

          window.track('frame_captured', {
            projectId: `${id}`,
            trackId: `${track}`,
            reverseX: settings.REVERSE_X,
            reverseY: settings.REVERSE_Y,
            nbFrames: nbFramesToTakeForAvg,
            maskingMode,
            frameType,
          });

          if (settings.SOUNDS) {
            const isAprilFoolsDay = new Date().getDate() === 1 && new Date().getMonth() === 3;
            playSound(isAprilFoolsDay ? soundEagle : soundShutter);
          }

          // Save frame
          const replaceId = maskingMode === 'DISABLED' ? replaceQueue.find((id) => pictures.some((p) => p.id === id)) : null;
          if (replaceId) {
            await projectActions.replaceFrame(track, replaceId, frame, activePerspective ? { perspective: activePerspective } : {});
            setReplaceQueue((q) => q.filter((id) => id !== replaceId));
          } else if (pendingBackgroundFrame || maskingMode === 'DISABLED') {
            await projectActions.addFrame(track, frame, isPlaying ? false : currentFrameId, pendingBackgroundFrame || null, activePerspective ? { perspective: activePerspective } : {});
          } else if (maskingMode === 'UNIQUE' || !pendingBackgroundFrame) {
            setPendingBackgroundFrame(await projectActions.savePicture(track, frame));
          }

          // Clean background
          if (maskingMode === 'DISABLED' || (maskingMode === 'UNIQUE' && pendingBackgroundFrame)) {
            setPendingBackgroundFrame(null);
          }
          setNotice(null);
        } catch (err) {
          if (settings.SOUNDS) {
            playSound(soundError);
          }
          console.error('Failed to take a picture', err);
          setNotice({ tone: 'error', message: `${t('Picture not taken')}: ${err?.message || err}` });
        }
      }

      flushSync(() => {
        setIsTakingPicture(false);
      });
    };

  // Switching views never touches the shutter. While posing it turns the table to that view;
  // while reviewing captured frames it only swaps the photos shown, so a review never moves the rig.
  const selectPerspective = async (view) => {
    if (turntable.state.moving || turntable.state.locked) {
      turntable.log(`View ${view} ignored: ${turntable.state.locked ? 'a rotation capture has the table' : 'the table is still moving'}`);
      return;
    }
    setActivePerspective(view);
    setPerspectiveStatus('');
    if (!view) return;
    if (reviewingFrames) {
      turntable.log(`View ${view} shown without turning: a captured frame is selected`);
      return;
    }
    await turnToPerspective(view);
  };

  // A view that cannot turn the table always says why: a silent button reads as a broken one
  const turnToPerspective = async (view) => {
    if (turntable.state.moving || turntable.state.locked) return;
    const target = turntableProfile.perspectives[view];
    // A dropped link is picked up again on the spot rather than leaving the view buttons dead
    if (!turntable.state.connected) {
      // A view never set on a table (references only) has nowhere to turn to
      if (!turntable.state.supported || turntable.state.connecting || target === null || target === undefined) return;
      turntable.log(`View ${view}: turntable not connected${turntable.state.error ? ` (${turntable.state.error})` : ''}, connecting`);
      setPerspectiveStatus(t('Connecting the turntable…'));
      try {
        await turntableActions.connect();
      } catch (err) {
        setPerspectiveStatus(t('The turntable is not connected: {{error}}', { error: err.message }));
        return;
      }
    }
    if (target === null || target === undefined) {
      turntable.log(`View ${view} not turned: no position set for it`);
      setPerspectiveStatus(t('{{view}} is not set on the turntable yet: line it up with the reference, then Set here', { view: t(view) }));
      return;
    }
    turntable.log(`View ${view}: turning from ${turntable.state.position} to ${nearestEquivalent(target, turntable.state.position ?? target, turntable.state.stepsPerRev)}`);
    const steps = nearestEquivalent(target, turntable.state.position ?? target, turntable.state.stepsPerRev);
    setPerspectiveStatus(t('Turning to {{view}}…', { view: t(view) }));
    try {
      // With tag alignment on, the motor only gets the table close: the tags in the live view finish the job
      const turned = await turnToView({ profile: turntableProfile, view });
      if (turned.arrived !== steps) {
        setPerspectiveStatus(t('Stopped before reaching {{view}}', { view: t(view) }));
        return;
      }
      setPerspectiveStatus(t('At {{view}} — settling…', { view: t(view) }));
      await new Promise((resolve) => setTimeout(resolve, turntableProfile.settleMs));
      if (turned.tags?.ok) {
        setPerspectiveStatus(t('At {{view}} — matched to the tags within {{px}} px ({{steps}} steps corrected)', { view: t(view), px: turned.tags.residualPx, steps: turned.tags.moved }));
      } else if (turned.tags) {
        setPerspectiveStatus(`${t('At {{view}}', { view: t(view) })} — ${tagFailure(t, turned.tags)}`);
      } else if (turned.noReference) {
        setPerspectiveStatus(t('At {{view}} by motor angle only: no tags are stored for it. Press Set here with the tags in view.', { view: t(view) }));
      } else {
        setPerspectiveStatus(t('At {{view}}', { view: t(view) }));
      }
      // While posing (live), keep a live-view snapshot of this view for the view's onion skin
      if (currentFrameId === false && STOPMO_CAMERA_AVAILABLE) {
        const blob = await stopmoGrabLiveFrame();
        if (blob) await projectActions.savePerspectiveView(track, view, blob);
      }
    } catch (err) {
      turntable.log(`View ${view} failed: ${err.message}`);
      setPerspectiveStatus(err.message);
    }
  };

  const actionsEvents = {
    PLAY: () => {
      if (isPlaying) {
        playerRef.current.stop();
      } else {
        playerRef.current.play(settings.PLAY_FROM_BEGINING);
      }
    },
    TAKE_PICTURE: takePictures(),
    TAKE_PICTURES_1: takePictures(1),
    TAKE_PICTURES_2: takePictures(2),
    TAKE_PICTURES_3: takePictures(3),
    TAKE_PICTURES_4: takePictures(4),
    TAKE_PICTURES_5: takePictures(5),
    TAKE_PICTURES_6: takePictures(6),
    TAKE_PICTURES_7: takePictures(7),
    TAKE_PICTURES_8: takePictures(8),
    TAKE_PICTURES_9: takePictures(9),
    TAKE_PICTURES_10: takePictures(10),
    LOOP: () => {
      setLoopStatus(!loopStatus);
      window.track('animator_changed', { feature: 'loop', value: !loopStatus });
    },
    SHORT_PLAY: () => {
      setShortPlayStatus(!shortPlayStatus);
      window.track('animator_changed', { feature: 'short_play', value: !shortPlayStatus });
    },
    CAMERA_SETTINGS: () => {
      playerRef.current.showFrame(false);
      setActiveWindow((v) => (v === 'camera' ? null : 'camera'));
    },
    DELETE_FRAME: async () => {
      if (pictures.length === 0) {
        return;
      }
      let frameIdToDelete = currentFrameId;
      let newId = false;

      // If we are on the live view
      if (currentFrameId === false) {
        if (!deleteOnLiveViewConfirmation) {
          setDeleteOnLiveViewConfirmation(true);

          // Play sound
          if (settings.SOUNDS) {
            playSound(soundDeleteConfirm);
          }

          // Break here, don't delete
          return;
        }

        frameIdToDelete = getLastFrameId(pictures);
        setDeleteOnLiveViewConfirmation(false);
      } else {
        newId = getPreviousFrameId(pictures, frameIdToDelete) !== frameIdToDelete ? getPreviousFrameId(pictures, frameIdToDelete) : getNextFrameId(pictures, frameIdToDelete);
      }

      // Play sound
      if (settings.SOUNDS) {
        playSound(soundDelete);
      }

      // Show right frame and execute deletion
      playerRef.current.showFrame(newId);
      projectActions.deleteFrame(track, frameIdToDelete);
      window.track('frame_deleted', { projectId: `${id}`, trackId: `${track}`, frameId: `${frameIdToDelete}` });
    },
    BACK: () => {
      navigate('/');
    },
    FRAME_LEFT: () => {
      const newId = getPreviousFrameId(pictures, currentFrameId, settings.SKIP_HIDDEN_FRAMES);
      playerRef.current.showFrame(newId);
    },
    FRAME_RIGHT: () => {
      const newId = getNextFrameId(pictures, currentFrameId, settings.SKIP_HIDDEN_FRAMES);
      playerRef.current.showFrame(newId);
    },
    ALTERNATIVE_FRAME_LEFT: () => {
      const newId = getPreviousFrameId(pictures, currentFrameId, !settings.SKIP_HIDDEN_FRAMES);
      playerRef.current.showFrame(newId);
    },
    ALTERNATIVE_FRAME_RIGHT: () => {
      const newId = getNextFrameId(pictures, currentFrameId, !settings.SKIP_HIDDEN_FRAMES);
      playerRef.current.showFrame(newId);
    },
    FRAME_LIVE: () => {
      playerRef.current.showFrame(false);
    },
    FRAME_FIRST: () => {
      const newId = getFirstFrameId(pictures);
      playerRef.current.showFrame(newId);
    },
    ONION_LESS: () => {
      if (!differenceStatus && (framePosition === false || onionEnabled)) {
        setOnionValue(Math.max(parseFloat(onionValue) - 0.1, 0));
        window.track('animator_changed', { feature: 'onion', value: Math.max(parseFloat(onionValue) - 0.1, 0) });
      }
    },
    ONION_MORE: () => {
      if (!differenceStatus && (framePosition === false || onionEnabled)) {
        setOnionValue(Math.min(parseFloat(onionValue) + 0.1, 1));
        window.track('animator_changed', { feature: 'onion', value: Math.min(parseFloat(onionValue) + 0.1, 1) });
      }
    },
    ONION_CHANGE: (value) => {
      setOnionValue(value);
      window.track('animator_changed', { feature: 'onion', value: value });
    },
    ONION_SETTINGS: () => {
      setActiveWindow((v) => (v === 'onion' ? null : 'onion'));
    },
    // Plays the reference sequence over the live view; from the top again once it has run out
    REFERENCE_VISIBLE: () => settingsActions.setSettings({ REFERENCES_HIDDEN: !settings.REFERENCES_HIDDEN }),
    VIEW_ROWS: () => settingsActions.setSettings({ VIEW_ROWS: { OPEN: !settings.VIEW_ROWS?.OPEN } }),
    ONION_TOGGLE: () => {
      settingsActions.setSettings({ ONION_SKIN: { ...onionConfig, ENABLED: !onionConfig.ENABLED } });
    },
    ONION_SKIN_CHANGE: (config) => {
      settingsActions.setSettings({ ONION_SKIN: normalizeOnionSkin(config) });
    },
    ONION_REFERENCE_SET: () => {
      if (currentFrameId !== false) {
        setReferenceFrameId(currentFrameId);
      }
    },
    ONION_REFERENCE_CLEAR: () => {
      setReferenceFrameId(null);
    },
    ONION_REFERENCE_TOGGLE: () => {
      if (referenceFrameId !== null && (currentFrameId === false || currentFrameId === referenceFrameId)) {
        setReferenceFrameId(null);
      } else if (currentFrameId !== false) {
        setReferenceFrameId(currentFrameId);
      }
    },
    GRID: () => {
      if (framePosition === false) {
        setGridStatus(!gridStatus);
        window.track('animator_changed', { feature: 'grid', value: !gridStatus });
      }
    },
    DIFFERENCE: () => {
      if (framePosition === false) {
        setDifferenceStatus(!differenceStatus);
        window.track('animator_changed', { feature: 'difference', value: !differenceStatus });
      }
    },
    FPS_CHANGE: async (v) => {
      projectActions.changeFPS(track, v || '1');
      if (isPlaying) {
        playerRef?.current?.stop();
      }
    },
    RATIO_CHANGE: async (v) => {
      projectActions.changeRatio(track, v || null);
    },
    SETTINGS: () => {
      navigate(`/settings?back=/animator/${id}/${track}`);
    },
    PROJECT: () => {
      setActiveWindow((v) => (v === 'scenes' ? null : 'scenes'));
    },
    ADD_SCENE: async () => {
      const newIndex = project.scenes.length;
      const newVisualIndex = project.scenes.filter((s) => !s.deleted).length + 1; // To be displayed
      const currentFps = project?.scenes?.[track]?.framerate || Number(settings?.DEFAULT_FPS) || DEFAULT_FPS;
      const currentRatio = project?.scenes?.[track]?.ratio || null;
      await projectActions.addScene(t('Untitled scene #{{index}}', { index: newVisualIndex }), currentFps, currentRatio);
      window.track('scene_added', { projectId: `${id}`, trackId: `${newIndex}` });
      navigate(`/animator/${id}/${newIndex}`);
      setActiveWindow(null);
    },
    DELETE_SCENE: async () => {
      const indexToDelete = Number(sceneEditingIndex);
      const aliveOthers = project.scenes.filter((s, i) => i !== indexToDelete && !s.deleted);
      if (aliveOthers.length === 0) {
        return;
      }
      projectActions.deleteScene(indexToDelete);
      setActiveWindow(null);
      window.track('scene_deleted', { projectId: `${id}`, trackId: `${indexToDelete}` });
    },
    UNDO: () => {
      if (!isPlaying) projectActions.undo();
    },
    REDO: () => {
      if (!isPlaying) projectActions.redo();
    },
    SHOW_TOOLS: () => {
      if (currentFrameId === false) {
        playerRef.current.showFrame(false);
        setActiveWindow((v) => (v === 'tools' ? null : 'tools'));
      }
    },
    SHOW_PICTURE_OPTIONS: () => {
      if (currentFrameId !== false) {
        setActiveWindow((v) => (v === 'picture' ? null : 'picture'));
      }
    },
    EXPORT: () => {
      navigate(`/export/${id}/${track}?back=/animator/${id}/${track}`);
    },
    HIDE_FRAME: async () => {
      projectActions.applyHiddenFrameStatus(track, currentFrameId, !currentFrame?.hidden);
      window.track('frame_hidden', { projectId: `${id}`, trackId: `${track}`, frameId: `${currentFrameId}`, hidden: !currentFrame?.hidden });
    },
    DUPLICATE: async () => {
      projectActions.applyDuplicateFrameOffset(track, currentFrameId, 1);
      window.track('frame_duplicated', { projectId: `${id}`, trackId: `${track}`, frameId: `${currentFrameId}`, offset: 1 });
    },
    CLONE: async () => {
      projectActions.cloneFrame(track, currentFrameId);
      window.track('frame_cloned', { projectId: `${id}`, trackId: `${track}`, frameId: `${currentFrameId}` });
    },
    DEDUPLICATE: async () => {
      projectActions.applyDuplicateFrameOffset(track, currentFrameId, -1);
      window.track('frame_duplicated', { projectId: `${id}`, trackId: `${track}`, frameId: `${currentFrameId}`, offset: -1 });
    },
    SET_DUPLICATE_COUNT: (value) => {
      const target = Math.min(MAX_FRAME_DUPLICATION, Math.max(1, Math.round(Number(value) || 1)));
      const offset = target - (currentFrame?.length || 1);
      if (!offset) return;
      projectActions.applyDuplicateFrameOffset(track, currentFrameId, offset);
      window.track('frame_duplicated', { projectId: `${id}`, trackId: `${track}`, frameId: `${currentFrameId}`, offset });
    },
    MUTE: () => {
      const newValue = !settings.SOUNDS;
      settingsActions.setSettings({ SOUNDS: newValue });
      window.track('animator_changed', { feature: 'mute', value: newValue });
    },
    DELETE_PROJECT: async () => {
      await window.EA('DELETE_PROJECT', { project_id: id });
      navigate(`/`);
      window.track('project_deleted', { projectId: id });
    },
    TOGGLE_MASKING_MODE: () => {
      const values = ['DISABLED', 'CONTINUOUS', 'UNIQUE'];
      const newMode = values?.[values?.indexOf(maskingMode) + 1] || values?.[0];
      if (newMode === 'DISABLED') {
        setPendingBackgroundFrame(null);
      }
      setMaskingMode(newMode);
      window.track('animator_changed', { feature: 'masking', value: newMode });
    },
    MASKING_EDITOR: () => {
      setActiveWindow('masking');
    },
  };

  const handlePlayerInit = (setStream) => {
    playerSetStream.current = setStream;
    cameraActions.setStream(setStream);
  };

  // After the camera has been handed back to its own dials, this reconnects it and restarts live view.
  // It goes straight to the camera module: the hook's connect is a no-op while this camera is the active one.
  const retakeCameraControl = async () => {
    if (currentCamera && playerSetStream.current) await currentCamera.connect({ setStream: playerSetStream.current });
  };

  // Re-points the live-view stream and asks the camera to restart it: a stream left frozen on one frame
  // (the camera drops live view around a capture) comes back without touching the shutter
  const refreshLiveView = () => {
    retakeCameraControl().catch(() => null);
  };

  const handleCapabilityChange = async (id, value) => {
    cameraActions.setCapability(id, value);
  };

  const handleDevicesRefresh = async () => {
    cameraActions.refreshDevices();
  };

  const handleSceneSettingsChange = async (fields) => {
    projectActions.renameScene(sceneEditingIndex, fields.title || '');
    if (fields.fps) {
      projectActions.changeFPS(sceneEditingIndex, fields.fps);
      if (Number(sceneEditingIndex) === Number(track) && isPlaying) {
        playerRef?.current?.stop();
      }
    }
    projectActions.changeRatio(sceneEditingIndex, fields?.ratio?.userValue || null);
  };

  const handleCloseMaskingEditor = async () => {
    // Get new images
    const d = await maskingEditorRef.current.exportLayers();
    if (d && d?.frame && d?.layers?.transparent) {
      await projectActions.updateFrame(track, currentFrame?.id, d.frame, undefined, undefined, d.layers.transparent);
    }

    // Close editor
    setActiveWindow(null);

    // Force player sync
    setTimeout(() => {
      playerRef.current.showFrame(currentFrame?.id);
    }, 0);
  };

  const frameCaptureMode = maskingMode !== 'DISABLED' && !isPlaying ? (pendingBackgroundFrame ? 'FOREGROUND' : 'BACKGROUND') : null;
  const canExport =
    pictures?.some((e) => !e?.hidden) &&
    (appCapabilities.includes('EXPORT_VIDEO') || appCapabilities.includes('EXPORT_FRAMES') || (appCapabilities.includes('BACKGROUND_SYNC') && settings?.EVENT_MODE_ENABLED));

  // Actions
  // Light is Classic, dark is Phosphor; 'system' follows macOS until it is switched here
  const isDarkTheme = (document.body.dataset.theme || 'light') === 'dark';
  const primaryActions = [
    { title: t('Back'), icon: faArrowLeft, onClick: handleAction.bind(null, 'BACK') },
    {
      title: isDarkTheme ? t('Switch to the light theme') : t('Switch to the dark theme'),
      icon: faBrightness,
      selected: isDarkTheme,
      onClick: () => settingsActions.setSettings({ THEME: isDarkTheme ? 'light' : 'dark' }),
    },
  ];

  const canonAction = STOPMO_CAMERA_AVAILABLE
    ? [
        {
          title: !canonStatus?.ready
            ? t('Canon camera not connected — camera settings')
            : canonStatus.focus === 'AF'
              ? t('Lens is on AF — the camera will not fire if it cannot focus. Switch to MF.')
              : t('{{model}} connected — camera settings', { model: canonStatus.model || 'Canon' }),
          icon: faCamera,
          onClick: () => setActiveWindow((v) => (v === 'camera-test' ? null : 'camera-test')),
          selected: !!canonStatus?.ready && canonStatus.focus !== 'AF',
          warning: !canonStatus?.ready || canonStatus.focus === 'AF',
        },
      ]
    : [];
  const turntableAction = STOPMO_CAMERA_AVAILABLE
    ? [
        {
          title: turntableState.connected ? t('Turntable connected') : t('Turntable'),
          icon: faRotate,
          onClick: () => setActiveWindow((v) => (v === 'turntable' ? null : 'turntable')),
          selected: turntableState.connected,
        },
      ]
    : [];
  const livePanel = { OPEN: false, ...(settings.LIVE_PANEL || {}) };

  const setLivePanel = (patch) => settingsActions.setSettings({ LIVE_PANEL: { ...livePanel, ...patch } });
  const magnifier = { ...settings.MAGNIFIER };
  const setMagnifier = (patch) => settingsActions.setSettings({ MAGNIFIER: { ...magnifier, ...patch } });
  const magnifierCentre = magnifierCenter || { cx: magnifier.CX ?? 0.5, cy: magnifier.CY ?? 0.5 };
  const commitMagnifierCentre = (c) => {
    setMagnifierCenter(c);
    setMagnifier({ CX: c.cx, CY: c.cy });
  };
  const rotationLayout = { ...(settings.ROTATION_PANEL || {}) };
  const viewRowsOpen = !!settings.VIEW_ROWS?.OPEN;
  const xsheetLayout = { OPEN: false, ...(settings.XSHEET || {}) };
  const setXsheetLayout = (patch) => settingsActions.setSettings({ XSHEET: { ...xsheetLayout, ...patch } });
  const captureModeAction = turntableState.connected
    ? [
        {
          title: turntableProfile.rotationCapture
            ? t('Full turn: {{n}} × {{h}} heights per frame (click for single photo)', { n: turntableProfile.shotsPerPass, h: turntableProfile.heights })
            : t('Single photo per frame (click for full turn)'),
          icon: turntableProfile.rotationCapture ? faImages : faCamera,
          onClick: () => turntableActions.updateProfile({ rotationCapture: !turntableProfile.rotationCapture }),
          selected: !!turntableProfile.rotationCapture,
        },
      ]
    : [];
  const liveActions = [
    {
      title: xsheetLayout.OPEN ? t('Hide X-sheet') : t('X-sheet (frame list)'),
      icon: faXSheet,
      onClick: () => setXsheetLayout({ OPEN: !xsheetLayout.OPEN }),
      selected: !!xsheetLayout.OPEN,
    },
    {
      title: livePanel.OPEN ? t('Hide live controls') : t('Live controls (views, turntable, focus aids, scopes)'),
      icon: faFaceViewfinder,
      onClick: () => setLivePanel({ OPEN: !livePanel.OPEN }),
      selected: !!livePanel.OPEN,
    },
    {
      title: settings.FOCUS_PEAKING?.ENABLED ? t('Focus peaking on') : t('Focus peaking off'),
      icon: faCrosshairs,
      onClick: () => settingsActions.setSettings({ FOCUS_PEAKING: { ...settings.FOCUS_PEAKING, ENABLED: !settings.FOCUS_PEAKING?.ENABLED } }),
      selected: !!settings.FOCUS_PEAKING?.ENABLED,
    },
    {
      title: magnifier.ENABLED ? t('Magnifier on') : t('Magnifier off'),
      icon: faMagnifyingGlass,
      onClick: () => setMagnifier({ ENABLED: !magnifier.ENABLED }),
      selected: !!magnifier.ENABLED,
    },
    {
      title: settings.HISTOGRAM?.ENABLED ? t('Histogram on') : t('Histogram off'),
      icon: faSignal,
      onClick: () => settingsActions.setSettings({ HISTOGRAM: { ...settings.HISTOGRAM, ENABLED: !settings.HISTOGRAM?.ENABLED } }),
      selected: !!settings.HISTOGRAM?.ENABLED,
    },
    {
      title: settings.PARADE?.ENABLED ? t('RGB parade on') : t('RGB parade off'),
      icon: faWaveform,
      onClick: () => settingsActions.setSettings({ PARADE: { ...settings.PARADE, ENABLED: !settings.PARADE?.ENABLED } }),
      selected: !!settings.PARADE?.ENABLED,
    },
  ];
  const importReferences = async (files, name, perspective = null) => {
    setReferenceImport({ done: 0, total: files.length });
    try {
      await projectActions.importReferenceSequence(track, files, name, (done, total) => setReferenceImport({ done, total }), perspective ? { perspective } : {});
    } finally {
      setReferenceImport(null);
    }
  };
  const secondaryActions = [
    ...liveActions,
    ...captureModeAction,
    ...canonAction,
    ...turntableAction,
    ...(canExport ? [{ title: t('Export'), icon: faBoxArrowDown, onClick: handleAction.bind(null, 'EXPORT') }] : []),
  ];

  const mobileActionsTop = [
    {
      title: currentFrame === false || isPlaying ? t('More') : t('Frame actions'),
      icon: currentFrame === false || isPlaying ? faEllipsisVertical : faImage,
      dataTour: currentFrame === false || isPlaying ? 'playback-tools-settings' : '',
      onClick: handleAction.bind(null, currentFrame === false || isPlaying ? 'SHOW_TOOLS' : 'SHOW_PICTURE_OPTIONS'),
      disabled: isPlaying,
    },
  ];

  const mobileActionsMiddle = [
    {
      title: t('Masking mode ({{status}})'),
      tag: maskingMode !== 'DISABLED' ? (MASKING_MODES[maskingMode] || MASKING_MODES.DISABLED)(t).slice(0, 1) : '',
      icon: faEraser,
      onClick: handleAction.bind(null, 'TOGGLE_MASKING_MODE'),
      selected: maskingMode !== 'DISABLED',
      disabled: isPlaying,
    },
    { title: t('Take a picture'), icon: faCamera, onClick: handleAction.bind(null, 'TAKE_PICTURE'), color: 'primary', disabled: isTakingPicture || !isCameraReady, dataTour: 'capture-mobile' },
    { title: t('Camera settings'), icon: faSliders, onClick: handleAction.bind(null, 'CAMERA_SETTINGS'), disabled: isPlaying, dataTour: 'camera-settings-mobile' },
  ];

  const mobileActionsBottom = [
    {
      title: !isPlaying ? t('Play') : t('Stop'),
      icon: isPlaying ? faStop : faPlay,
      onClick: handleAction.bind(null, 'PLAY'),
      selectedColor: 'warning',
      selected: isPlaying,
      dataTour: 'playback-mobile',
    },
  ];

  const projectAction = { title: t('Project'), icon: faFolder, onClick: handleAction.bind(null, 'PROJECT'), dataTour: 'project-settings-mobile' };

  return (
    <>
      <LoadingPage show={false} />
      <PageLayout hasMobileLeftBar={true} hasMobileRightBar={true}>
        <DesktopNavigation leftActions={primaryActions} rightActions={secondaryActions} withBorder={false}>
          <SceneSelector
            scenes={visibleScenes.map((s) => ({ id: s.id, index: s.index, title: s.title, framerate: s.framerate, pictureCount: s.pictures?.filter((p) => !p.deleted).length ?? 0 }))}
            currentTrack={track}
            disabled={isPlaying}
            projectTitle={project?.title}
            onProjectTitleChange={(title) => projectActions.rename(title || '')}
            onProjectDelete={() => handleAction('DELETE_PROJECT')}
            onSelect={(newIndex) => {
              if (Number(newIndex) !== Number(track)) {
                navigate(`/animator/${id}/${newIndex}`);
              }
            }}
            onCreate={() => handleAction('ADD_SCENE')}
            onEditScene={(sceneIndex) => {
              setSceneEditingIndex(sceneIndex);
              setActiveWindow('scene');
            }}
          />
        </DesktopNavigation>
        <MobileNavigation
          topLeftActions={primaryActions}
          bottomLeftActions={[projectAction, ...secondaryActions]}
          topRightActions={mobileActionsTop}
          middleRightActions={mobileActionsMiddle}
          bottomRightActions={mobileActionsBottom}
          showLeftActions={true}
          showRightActions={true}
        />
        <Player
          t={t}
          ref={playerRef}
          isCameraReady={isCameraReady}
          onInit={handlePlayerInit}
          onFrameChange={setCurrentFrameId}
          onPlayingStatusChange={setIsPlaying}
          isPlaying={isPlaying}
          pictures={playerPictures}
          onionValue={onionValue}
          onionSkin={onionConfig}
          referenceFrameId={referenceFramePosition ? referenceFrameId : null}
          references={referencesHidden ? [] : playerReferences}
          alignReference={alignReference}
          referencePosition={referenceSeek}
          referenceTail={referenceCells?.extra?.length || 0}
          onAlignReference={(patch) => setAlignDraft((d) => ({ ...(d || { x: alignReference?.x ?? 0, y: alignReference?.y ?? 0, scale: alignReference?.scale ?? 1 }), ...patch }))}
          onAlignReferenceCommit={() => {
            if (alignDraft && alignReferenceId) projectActions.updateReference(track, alignReferenceId, alignDraft);
            setAlignDraft(null);
          }}
          onAlignReferenceDone={() => {
            if (alignDraft && alignReferenceId) projectActions.updateReference(track, alignReferenceId, alignDraft);
            setAlignDraft(null);
            setAlignReferenceId(null);
          }}
          perspective={activePerspective}
          perspectiveViews={project.scenes[track]?.perspectiveViews}
          showGrid={gridStatus}
          blendMode={differenceStatus}
          shortPlayStatus={shortPlayStatus}
          shortPlayFrames={Number(settings.SHORT_PLAY) || 1}
          loopStatus={loopStatus}
          cameraId={currentCameraId}
          cameraCapabilities={currentCameraCapabilities}
          fps={fps}
          gridModes={settings.GRID_MODES}
          gridOpacity={parseFloat(settings.GRID_OPACITY)}
          gridColumns={Number(settings.GRID_COLUMNS)}
          gridLines={Number(settings.GRID_LINES)}
          ratioLayerOpacity={settings.RATIO_OPACITY}
          loopShowLive={settings.LOOP_SHOW_LIVE}
          videoRatio={ratio?.value || null}
          reverseX={settings.REVERSE_X}
          reverseY={settings.REVERSE_Y}
          focusPeaking={settings.FOCUS_PEAKING}
          magnifier={{ enabled: !!magnifier.ENABLED, center: magnifierCentre, zoom: magnifier.ZOOM || 4, aspect: magnifierAspect }}
          onMagnifierMove={setMagnifierCenter}
          onMagnifierCommit={commitMagnifierCentre}
        />
        <div>
          {replaceQueue.length > 0 ? (
            <NoticeBanner
              tone="warning"
              message={t('Replace mode: the next capture replaces frame {{n}}{{more}}. Close this to cancel.', {
                n: pictures.findIndex((p) => p.id === replaceQueue[0]) + 1,
                more: replaceQueue.length > 1 ? ` (${t('{{n}} to go', { n: replaceQueue.length })})` : '',
              })}
              onDismiss={() => setReplaceQueue([])}
            />
          ) : (
            <NoticeBanner message={notice?.message} tone={notice?.tone} onDismiss={() => setNotice(null)} />
          )}
          {showPerspectives && (!livePanel.OPEN || livePanel.COLLAPSED) && (
            <PerspectiveBar
              active={activePerspective}
              status={perspectiveHint()}
              busy={turntableState.moving}
              reviewing={reviewingFrames}
              calibrated={Object.fromEntries(PERSPECTIVES.map((v) => [v, turntableState.connected && turntableProfile.perspectives[v] !== null]))}
              onSelect={selectPerspective}
              onTurn={!reviewingFrames && activePerspective && !tableAtActiveView ? () => turnToPerspective(activePerspective) : null}
            />
          )}
          {settings?.EVENT_MODE_ENABLED && (
            <LimitWarning nbFrames={pictures.length} nbFramesLimit={settings?.LIMIT_NUMBER_OF_FRAMES} startedAt={startedAt} activityDuration={settings?.LIMIT_ACTIVITY_DURATION} />
          )}
          <ControlBar
            onAction={handleAction}
            showCameraSettings={activeWindow === 'camera'}
            gridModes={settings.GRID_MODES}
            gridColumns={Number(settings.GRID_COLUMNS)}
            gridLines={Number(settings.GRID_LINES)}
            gridStatus={gridStatus}
            differenceStatus={differenceStatus}
            onionValue={onionValue}
            onionEnabled={onionEnabled}
            showOnionSettings={activeWindow === 'onion'}
            hasReference={referenceLength > 0}
            referencesHidden={referencesHidden}
            hasViewRows={viewRows.length > 0}
            viewRowsOpen={viewRowsOpen}
            isPlaying={isPlaying}
            isCameraReady={!!currentCamera}
            isTakingPicture={isTakingPicture}
            shortPlayStatus={shortPlayStatus}
            loopStatus={loopStatus}
            fps={fps}
            canDeduplicate={currentFrame.length > 1}
            canDuplicate={(currentFrame.length || 1) < MAX_FRAME_DUPLICATION}
            framePosition={framePosition}
            frameQuantity={pictures.length}
            isCurrentFrameHidden={!!currentFrame.hidden}
            canUseMaskingEditor={!!currentFrame.masking}
            totalAnimationFrames={totalAnimationFrames}
            maskingMode={maskingMode}
          />
          {expandedFrame && !isPlaying && (
            <SequenceStrip
              frame={expandedFrame}
              frameNumber={pictures.findIndex((p) => p.id === expandedFrame.id) + 1}
              selected={shotPreview?.frameId === expandedFrame.id ? shotPreview.filename : null}
              onPreview={(filename) => {
                setShotPreview(filename ? { frameId: expandedFrame.id, filename } : null);
                if (filename) handleSelectFrame(expandedFrame.id);
              }}
              canReshoot={turntableState.connected && !rotationRun}
              onReshootHeight={(height) => runRotationCapture(null, { frame: expandedFrame, height })}
              onClose={() => {
                setExpandedFrameId(null);
                setShotPreview(null);
              }}
            />
          )}
          {viewRowsOpen && (
            <ViewTimelines
              rows={viewRows}
              active={activePerspective}
              current={currentFrameId}
              onPick={(frameId, view) => {
                setShotPreview(null);
                // Picking a photo shows that frame from that view; the row name alone follows the live rules
                if (frameId === false) {
                  selectPerspective(view);
                  return;
                }
                setActivePerspective(view);
                setPerspectiveStatus('');
                handleSelectFrame(frameId);
                setFrameSelection({ selected: [frameId], anchor: frameId });
              }}
              onPlay={(view) => {
                setShotPreview(null);
                flushSync(() => {
                  setActivePerspective(view);
                  setPerspectiveStatus('');
                });
                playerRef.current.play(settings.PLAY_FROM_BEGINING);
              }}
            />
          )}
          <Timeline
            referenceCells={referenceCells}
            onReferenceSeek={(position) => {
              if (currentFrameId !== false) handleSelectFrame(false);
              setReferenceSeek(position);
            }}
            viewLabel={
              viewRows.length || showPerspectives
                ? {
                    name: activePerspective ? t(activePerspective) : t('ALL'),
                    detail: activePerspective && viewAngle !== null ? `${(Math.round(viewAngle * 10) / 10) % 360}°` : t('as shot'),
                    hint: activePerspective ? t('The timeline is showing every frame from {{view}}', { view: t(activePerspective) }) : t('The timeline is showing each frame as it was captured'),
                  }
                : null
            }
            pictures={viewPictures}
            selectedIds={frameSelection.selected}
            expandedId={expandedFrameId}
            onExpand={(frameId) => {
              setShotPreview(null);
              setExpandedFrameId((current) => (current === frameId ? null : frameId));
            }}
            onSelect={(frameId, modifiers = {}) => {
              if (frameId === false) {
                handleSelectFrame(false);
                return;
              }
              const order = viewPictures.map((p) => p.id);
              setFrameSelection((sel) => selectionClick({ order, selected: sel.selected, anchor: sel.anchor }, frameId, modifiers));
              handleSelectFrame(frameId);
            }}
            onMove={handleFrameMove}
            select={currentFrameId}
            playing={isPlaying}
            shortPlayStatus={shortPlayStatus}
            shortPlayFrames={Number(settings.SHORT_PLAY) || 1}
            frameCaptureMode={frameCaptureMode}
          />
        </div>
      </PageLayout>
      {activeWindow === null && !isPlaying && <ImportOverlay onPictureAdd={handleImportPicture} />}
      {activeWindow === null && <KeyboardHandler onAction={handleAction} />}
      {magnifier.ENABLED && (
        <MagnifierWindow
          enabled={isCameraReady && currentFrameId === false}
          layout={magnifier}
          center={magnifierCentre}
          getSource={getLiveCanvas}
          onCenterChange={setMagnifierCenter}
          onCenterCommit={commitMagnifierCentre}
          onAspectChange={setMagnifierAspect}
          onLayoutChange={setMagnifier}
          onClose={() => setMagnifier({ ENABLED: false })}
        />
      )}
      {settings.PARADE?.ENABLED && (
        <ParadeWindow
          enabled={isCameraReady && currentFrameId === false}
          layout={settings.PARADE}
          getSource={getLiveCanvas}
          onLayoutChange={(patch) => settingsActions.setSettings({ PARADE: { ...settings.PARADE, ...patch } })}
          onClose={() => settingsActions.setSettings({ PARADE: { ...settings.PARADE, ENABLED: false } })}
        />
      )}
      {settings.HISTOGRAM?.ENABLED && (
        <HistogramWindow
          enabled={isCameraReady && currentFrameId === false}
          layout={settings.HISTOGRAM}
          getSource={getLiveCanvas}
          onLayoutChange={(patch) => settingsActions.setSettings({ HISTOGRAM: { ...settings.HISTOGRAM, ...patch } })}
          onClose={() => settingsActions.setSettings({ HISTOGRAM: { ...settings.HISTOGRAM, ENABLED: false } })}
        />
      )}
      <RotationCaptureProgress
        run={rotationRun}
        layout={rotationLayout}
        onLayoutChange={(patch) => settingsActions.setSettings({ ROTATION_PANEL: { ...rotationLayout, ...patch } })}
        onContinue={continueRotation}
        onPause={pauseRotation}
        onResume={resumeRotation}
        onRetry={retryRotationShot}
        onRetryMove={retryRotationMove}
        onRedoHeight={redoRotationHeight}
        onStop={stopRotation}
      />
      {xsheetLayout.OPEN && (
        <XSheet
          layout={xsheetLayout}
          pictures={viewPictures}
          projectTitle={project.title}
          sceneNumber={visibleScenes.findIndex((sc) => sc.index === Number(track)) + 1}
          fps={fps}
          current={currentFrameId}
          selected={frameSelection.selected}
          anchor={frameSelection.anchor}
          replacing={replaceQueue}
          onSelectionChange={(selected, anchor) => setFrameSelection({ selected, anchor })}
          onShowFrame={handleSelectFrame}
          onDelete={(ids) => {
            projectActions.deleteFrames(track, ids);
            setFrameSelection({ selected: [], anchor: null });
            setReplaceQueue((q) => q.filter((id) => !ids.includes(id)));
            if (ids.includes(currentFrameId)) handleSelectFrame(false);
          }}
          onReplaceWithCapture={(ids) => {
            setReplaceQueue(ids);
            handleSelectFrame(false);
          }}
          onReplaceWithFile={async (frameId, file) => {
            try {
              await projectActions.replaceFrame(track, frameId, { type: file.type || 'image/jpeg', buffer: await file.arrayBuffer() });
            } catch (err) {
              setNotice({ tone: 'error', message: `${t('Could not replace the frame')}: ${err?.message || err}` });
            }
          }}
          onCancelReplace={() => setReplaceQueue([])}
          onNote={(frameId, note) => projectActions.setFrameNote(track, frameId, note)}
          onLayoutChange={setXsheetLayout}
          onClose={() => setXsheetLayout({ OPEN: false })}
        />
      )}
      {livePanel.OPEN && !isPlaying && (
        <ViewsPanel
          layout={livePanel}
          active={activePerspective}
          status={perspectiveHint()}
          reviewing={reviewingFrames}
          busy={turntableState.moving}
          calibrated={Object.fromEntries(PERSPECTIVES.map((v) => [v, turntableState.connected && turntableProfile.perspectives[v] !== null]))}
          references={sceneReferences}
          importProgress={referenceImport}
          exposure={currentCameraCapabilities.filter((c) => EXPOSURE_CAPABILITIES.includes(c.id))}
          exposureAvailable={STOPMO_CAMERA_AVAILABLE}
          onExposureChange={handleCapabilityChange}
          onExposureRefresh={() => cameraActions.refreshCapabilities()}
          onSelect={selectPerspective}
          onTurn={!reviewingFrames && activePerspective && !tableAtActiveView ? () => turnToPerspective(activePerspective) : null}
          onImport={importReferences}
          onUpdateReference={(referenceId, patch) => projectActions.updateReference(track, referenceId, patch)}
          aligning={alignReferenceId}
          onAlign={setAlignReferenceId}
          onLayoutChange={setLivePanel}
          onClose={() => setLivePanel({ OPEN: false })}
          focusPeaking={settings.FOCUS_PEAKING}
          histogram={settings.HISTOGRAM}
          parade={settings.PARADE}
          magnifier={magnifier}
          onSettingsChange={settingsActions.setSettings}
        />
      )}
      {!isPlaying && (
        <>
          <Window isOpened={activeWindow === 'camera'} onClose={() => setActiveWindow(null)} title={t('Camera')} tone="yellow">
            <CameraSettingsWindow
              cameraCapabilities={currentCameraCapabilities}
              onCapabilityChange={handleCapabilityChange}
              onSettingsChange={handleSettingsChange}
              onDevicesListRefresh={handleDevicesRefresh}
              appCapabilities={appCapabilities}
              devices={devices}
              settings={settings}
              currentCameraId={currentCameraId}
            />
          </Window>
          <Window isOpened={activeWindow === 'tools'} onClose={() => setActiveWindow(null)} title={t('Tools')} tone="lime">
            <ToolsWindow
              onAction={handleAction}
              gridStatus={gridStatus}
              differenceStatus={differenceStatus}
              onionValue={onionValue}
              loopStatus={loopStatus}
              shortPlayStatus={shortPlayStatus}
              fps={fps}
              framePosition={framePosition}
            />
          </Window>
          <Window isOpened={activeWindow === 'turntable'} onClose={() => setActiveWindow(null)} title={t('Turntable')} tone="peach">
            <TurntableWindow />
          </Window>
          <Window isOpened={activeWindow === 'camera-test'} onClose={() => setActiveWindow(null)} title={t('Canon camera')} tone="mint">
            <CameraTestWindow isOpened={activeWindow === 'camera-test'} settings={settings} onSettingsChange={settingsActions.setSettings} onTakeControl={retakeCameraControl} />
          </Window>
          <Window isOpened={activeWindow === 'onion'} onClose={() => setActiveWindow(null)} title={t('Onion skin & references')} tone="lavender">
            <OnionSkinWindow
              config={onionConfig}
              onChange={(config) => handleAction('ONION_SKIN_CHANGE', config)}
              selectedFrameNumber={framePosition}
              referenceFrameNumber={referenceFramePosition}
              onPinReference={() => handleAction('ONION_REFERENCE_SET')}
              onClearReference={() => handleAction('ONION_REFERENCE_CLEAR')}
            >
              <ReferenceSequencesPanel
                references={sceneReferences}
                animationPosition={animationPosition}
                importProgress={referenceImport}
                onImport={(files, name) => importReferences(files, name)}
                onUpdate={(referenceId, patch) => projectActions.updateReference(track, referenceId, patch)}
                onDelete={(referenceId) => projectActions.deleteReference(track, referenceId)}
              />
            </OnionSkinWindow>
          </Window>
          <Window isOpened={activeWindow === 'picture'} onClose={() => setActiveWindow(null)} title={t('Frame')} tone="yellow">
            <PictureWindow
              onAction={(action, args) => {
                handleAction(action, args);
                // Close the sheet once the frame is gone (delete) — the other actions keep it open for quick edits
                if (action === 'DELETE_FRAME') {
                  setActiveWindow(null);
                }
              }}
              isHidden={!!currentFrame.hidden}
              duplicateCount={currentFrame.length || 1}
              maxDuplicateCount={MAX_FRAME_DUPLICATION}
              canUseMaskingEditor={!!currentFrame.masking}
            />
          </Window>
          <Window isOpened={activeWindow === 'scenes'} onClose={() => setActiveWindow(null)} title={t('Scenes')} tone="lime">
            <SceneSelectorWindow
              scenes={visibleScenes.map((s) => ({ id: s.id, index: s.index, title: s.title, framerate: s.framerate, pictureCount: s.pictures?.filter((p) => !p.deleted).length ?? 0 }))}
              currentTrack={track}
              projectTitle={project?.title}
              onProjectTitleChange={(title) => projectActions.rename(title || '')}
              onProjectDelete={() => handleAction('DELETE_PROJECT')}
              onSelect={(newIndex) => {
                if (Number(newIndex) !== Number(track)) {
                  navigate(`/animator/${id}/${newIndex}`);
                }
                setActiveWindow(null);
              }}
              onCreate={() => handleAction('ADD_SCENE')}
              onEditScene={(sceneIndex) => {
                setSceneEditingIndex(sceneIndex);
                setActiveWindow('scene');
              }}
            />
          </Window>
          <Window isOpened={activeWindow === 'scene'} onClose={() => setActiveWindow(null)} title={t('Scene settings')} tone="yellow">
            <SceneSettingsWindow
              key={sceneEditingIndex}
              title={editingScene?.title || ''}
              fps={editingFps}
              ratio={editingRatio?.userValue || null}
              canDelete={visibleScenes.length > 1}
              onSceneSettingsChange={handleSceneSettingsChange}
              onSceneDelete={() => handleAction('DELETE_SCENE')}
            />
          </Window>
          <Window isOpened={activeWindow === 'masking' && !isPlaying} onClose={handleCloseMaskingEditor} isFullScreen={true}>
            {currentFrame && currentFrame?.masking && (
              <MaskingWindow
                key={currentFrame.id}
                ref={maskingEditorRef}
                backgroundLayer={currentFrame?.masking?.background?.link || null}
                foregroundLayer={currentFrame?.masking?.foreground?.link || null}
                transparentLayer={currentFrame?.masking?.transparent?.link || null}
              />
            )}
          </Window>
        </>
      )}
      <Tour tourKey="ANIMATOR" />
    </>
  );
};

export default withTranslation()(Animator);
