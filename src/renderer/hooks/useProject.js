import { DEFAULT_FPS, MAX_FRAME_DUPLICATION } from '@config-web';
import { mimeTypeToExtension } from '@core/frameTypes';
import { useCallback, useEffect, useState } from 'react';
import { v4 } from 'uuid';

import { useHistory } from './useHistory';

function cleanProjectData(data) {
  const d = structuredClone(data);
  delete d._path;
  delete d._file;
  for (const scene of d.project.scenes) {
    for (const picture of scene.pictures) {
      delete picture.link;
      delete picture.metaLink;
      for (const shot of picture.sequence?.shots || []) {
        delete shot.link;
      }
      for (const layer of ['background', 'foreground', 'transparent']) {
        if (picture.masking?.[layer]) {
          delete picture.masking[layer].link;
          delete picture.masking[layer].metaLink;
        }
      }
    }
  }
  return d;
}

function getFingerprint(data) {
  if (!data?.project) return null;
  const d = cleanProjectData(data);
  return JSON.stringify({ title: d.project.title, scenes: d.project.scenes });
}

function useProject(options) {
  const projectId = options?.id || null;
  const [projectData, setProjectData] = useState(null);

  const { push: pushHistory, undo: historyUndo, redo: historyRedo, canUndo, canRedo } = useHistory({ key: projectId, serialize: getFingerprint });

  // Initial load
  useEffect(() => {
    window.EA('GET_PROJECT', { project_id: projectId }).then((data) => {
      setProjectData(data);
    });
  }, [projectId]);

  // Push to history on every real projectData change
  useEffect(() => {
    if (!projectData) return;
    pushHistory(projectData);
  }, [projectData, pushHistory]);

  // Auto save
  useEffect(() => {
    if (!projectData) return;
    window.EA('SAVE_PROJECT', { project_id: projectId, data: cleanProjectData(projectData) });
  }, [projectData, projectId]);

  // Action change FPS
  const actionChangeFPS = useCallback(async (trackId, fps = 1) => {
    if (Number(fps) > 0) {
      const sceneId = Number(trackId);
      setProjectData((oldData) => {
        let d = structuredClone(oldData);
        if (d.project.scenes[sceneId]) {
          d.project.scenes[sceneId].framerate = Number(fps);
        }
        return d;
      });
    }
  }, []);

  // Action change ratio
  const actionChangeRatio = useCallback(async (trackId, ratio = null) => {
    const sceneId = Number(trackId);
    setProjectData((oldData) => {
      let d = structuredClone(oldData);
      if (d.project.scenes[sceneId]) {
        d.project.scenes[sceneId].ratio = ratio || null;
      }
      return d;
    });
  }, []);

  // Action unhide frame
  const actionApplyHiddenFrameStatus = useCallback(async (trackId, frameId, isHidden = false) => {
    const sceneId = Number(trackId);
    setProjectData((oldData) => {
      let d = structuredClone(oldData);
      if (d.project.scenes[sceneId]) {
        d.project.scenes[sceneId].pictures = d.project.scenes[sceneId].pictures.map((p) => (`${p.id}` !== `${frameId}` ? p : { ...p, hidden: isHidden }));
      }
      return d;
    });
  }, []);

  // Action apply duplicate frame offset
  const actionApplyDuplicateFrameOffset = useCallback(async (trackId, frameId, offset = 0) => {
    const sceneId = Number(trackId);
    setProjectData((oldData) => {
      let d = structuredClone(oldData);
      if (d.project.scenes[sceneId]) {
        d.project.scenes[sceneId].pictures = d.project.scenes[sceneId].pictures.map((p) => {
          if (`${p.id}` !== `${frameId}`) {
            return p;
          } else {
            const length = (p.length || 1) + offset || 1;
            return { ...p, length: Math.min(MAX_FRAME_DUPLICATION, Math.max(1, length)) };
          }
        });
      }
      return d;
    });
  }, []);

  // Action clone frame
  const actionCloneFrame = useCallback(async (trackId, frameId) => {
    const sceneId = Number(trackId);
    setProjectData((oldData) => {
      let d = structuredClone(oldData);
      if (d.project.scenes[sceneId]) {
        const newId = v4();
        d.project.scenes[sceneId].pictures = d.project.scenes[sceneId].pictures.reduce((acc, p) => {
          if (`${p.id}` !== `${frameId}`) {
            return [...acc, p];
          } else {
            return [...acc, p, { ...p, id: newId }];
          }
        }, []);
      }
      return d;
    });
  }, []);

  // Action delete frame
  const actionDeleteFrame = useCallback(async (trackId, frameId) => {
    const sceneId = Number(trackId);
    setProjectData((oldData) => {
      let d = structuredClone(oldData);
      if (d.project.scenes[sceneId]) {
        d.project.scenes[sceneId].pictures = d.project.scenes[sceneId].pictures.map((p) => (`${p.id}` !== `${frameId}` ? p : { ...p, deleted: true }));
      }
      return d;
    });
  }, []);

  // Action delete several frames at once (one undo step); files stay on disk, frames are only flagged
  const actionDeleteFrames = useCallback(async (trackId, frameIds = []) => {
    const sceneId = Number(trackId);
    const ids = new Set(frameIds.map((id) => `${id}`));
    setProjectData((oldData) => {
      let d = structuredClone(oldData);
      if (d.project.scenes[sceneId]) {
        d.project.scenes[sceneId].pictures = d.project.scenes[sceneId].pictures.map((p) => (ids.has(`${p.id}`) ? { ...p, deleted: true } : p));
      }
      return d;
    });
  }, []);

  // Action set a frame's x-sheet note
  const actionSetFrameNote = useCallback(async (trackId, frameId, note = '') => {
    const sceneId = Number(trackId);
    setProjectData((oldData) => {
      let d = structuredClone(oldData);
      if (d.project.scenes[sceneId]) {
        d.project.scenes[sceneId].pictures = d.project.scenes[sceneId].pictures.map((p) => (`${p.id}` === `${frameId}` ? { ...p, note: `${note}` } : p));
      }
      return d;
    });
  }, []);

  // Action replace a frame's rotation record, keeping its picture (used when one camera height is re-shot)
  const actionSetFrameSequence = useCallback(async (trackId, frameId, sequence = null) => {
    const sceneId = Number(trackId);
    setProjectData((oldData) => {
      let d = structuredClone(oldData);
      if (d.project.scenes[sceneId]) {
        d.project.scenes[sceneId].pictures = d.project.scenes[sceneId].pictures.map((p) => (`${p.id}` === `${frameId}` ? { ...p, sequence } : p));
      }
      return d;
    });
  }, []);

  // Action drop every frame's own choice of photo for a view, so one choice made for all frames applies
  const actionClearViewShots = useCallback(async (trackId, view) => {
    const sceneId = Number(trackId);
    setProjectData((oldData) => {
      let d = structuredClone(oldData);
      for (const p of d.project.scenes[sceneId]?.pictures || []) {
        if (p.sequence?.viewShots) delete p.sequence.viewShots[view];
      }
      return d;
    });
  }, []);

  // Action rename
  const actionRename = useCallback(async (title) => {
    setProjectData((oldData) => {
      let d = structuredClone(oldData);
      d.project.title = title || '';
      return d;
    });
  }, []);

  // Action add scene (appended at the end, new index = previous scenes.length)
  const actionAddScene = useCallback(async (title, framerate = DEFAULT_FPS, ratio = null) => {
    setProjectData((oldData) => {
      let d = structuredClone(oldData);
      d.project.scenes.push({
        id: v4(),
        title: title || '',
        framerate: Number(framerate) || DEFAULT_FPS,
        ratio: ratio || null,
        pictures: [],
        deleted: false,
      });
      return d;
    });
  }, []);

  // Action rename scene
  const actionRenameScene = useCallback(async (trackId, title) => {
    const sceneId = Number(trackId);
    setProjectData((oldData) => {
      let d = structuredClone(oldData);
      if (d.project.scenes[sceneId]) {
        d.project.scenes[sceneId].title = title || '';
      }
      return d;
    });
  }, []);

  // Action delete scene (soft delete — keeps disk files & stable indices)
  const actionDeleteScene = useCallback(async (trackId) => {
    const sceneId = Number(trackId);
    setProjectData((oldData) => {
      let d = structuredClone(oldData);
      if (!d.project.scenes[sceneId]) {
        return d;
      }
      const aliveOthers = d.project.scenes.filter((s, i) => i !== sceneId && !s.deleted);
      if (aliveOthers.length === 0) {
        return d;
      }
      d.project.scenes[sceneId].deleted = true;
      return d;
    });
  }, []);

  // Action delete frame
  const actionMoveFrame = useCallback(async (trackId, frameId, beforeFrameId = false) => {
    const sceneId = Number(trackId);
    setProjectData((oldData) => {
      let d = structuredClone(oldData);
      if (d.project.scenes[sceneId]) {
        const index = beforeFrameId === false ? -1 : d.project.scenes[sceneId].pictures.findIndex((f) => `${f.id}` === `${beforeFrameId}`);
        const frame = d.project.scenes[sceneId].pictures.find((f) => `${f.id}` === `${frameId}`);
        if (frame) {
          if (index != -1) {
            d.project.scenes[sceneId].pictures = [
              ...d.project.scenes[sceneId].pictures.slice(0, index).filter((f) => `${f.id}` !== `${frameId}`),
              frame,
              ...d.project.scenes[sceneId].pictures.slice(index).filter((f) => `${f.id}` !== `${frameId}`),
            ];
          } else {
            d.project.scenes[sceneId].pictures = [...d.project.scenes[sceneId].pictures.filter((f) => `${f.id}` !== `${frameId}`), frame];
          }
        }
      }
      return d;
    });
  }, []);

  // Action update frame
  const actionUpdateFrame = useCallback(
    async (trackId, frameId, frameBuffer = null, backgroundBuffer = null, foregroundBuffer = null, transparentBuffer = null) => {
      const sceneId = Number(trackId);

      const [frameObject, backgroundObject, foregroundObject, transparentObject] = await Promise.all([
        frameBuffer
          ? window.EA('SAVE_PICTURE', {
              project_id: projectId,
              track_id: sceneId,
              buffer: Buffer.from(await frameBuffer.arrayBuffer()),
              extension: mimeTypeToExtension(frameBuffer.type),
            })
          : null,
        backgroundBuffer
          ? window.EA('SAVE_PICTURE', {
              project_id: projectId,
              track_id: sceneId,
              buffer: Buffer.from(await backgroundBuffer.arrayBuffer()),
              extension: mimeTypeToExtension(backgroundBuffer.type),
            })
          : null,
        foregroundBuffer
          ? window.EA('SAVE_PICTURE', {
              project_id: projectId,
              track_id: sceneId,
              buffer: Buffer.from(await foregroundBuffer.arrayBuffer()),
              extension: mimeTypeToExtension(foregroundBuffer.type),
            })
          : null,
        transparentBuffer
          ? window.EA('SAVE_PICTURE', {
              project_id: projectId,
              track_id: sceneId,
              buffer: Buffer.from(await transparentBuffer.arrayBuffer()),
              extension: mimeTypeToExtension(transparentBuffer.type),
            })
          : null,
      ]);

      const newIds = [v4(), v4(), v4(), v4()];

      setProjectData((oldData) => {
        let d = structuredClone(oldData);
        if (d.project.scenes[sceneId]) {
          for (let i = 0; i < d.project.scenes[sceneId].pictures.length; i++) {
            // Update main frame
            if (`${d.project.scenes[sceneId].pictures[i].id}` === `${frameId}`) {
              if (frameObject) {
                d.project.scenes[sceneId].pictures[i] = {
                  ...d.project.scenes[sceneId].pictures[i],
                  ...frameObject,
                };
              }

              // Update background frame
              if (d?.project?.scenes?.[sceneId]?.pictures?.[i]?.masking && backgroundObject) {
                d.project.scenes[sceneId].pictures[i].masking.background = { ...backgroundObject, id: newIds[1] };
              }

              // Update foreground frame
              if (d?.project?.scenes?.[sceneId]?.pictures?.[i]?.masking && foregroundObject) {
                d.project.scenes[sceneId].pictures[i].masking.foreground = { ...foregroundObject, id: newIds[2] };
              }

              // Update transparent frame
              if (d?.project?.scenes?.[sceneId]?.pictures?.[i]?.masking && transparentObject) {
                d.project.scenes[sceneId].pictures[i].masking.transparent = { ...transparentObject, id: newIds[3] };
              }
            }
          }
        }
        return d;
      });
    },
    [projectId]
  );

  // Action save picture
  const actionSavePicture = useCallback(
    async (trackId, blob) => {
      const sceneId = Number(trackId);
      const extension = mimeTypeToExtension(blob.type);

      // Save from direct-save URLs (Android)
      if (blob._directSaveUrls) {
        return window.EA('SAVE_PICTURE_FROM_URLS', {
          project_id: projectId,
          track_id: sceneId,
          urls: blob._directSaveUrls,
          authorization: blob._directSaveAuthorization,
          reverseX: blob._reverseX || false,
          reverseY: blob._reverseY || false,
          extension,
        });
      }

      // Save from blob (Electron / Web)
      return window.EA('SAVE_PICTURE', {
        project_id: projectId,
        track_id: sceneId,
        buffer: Buffer.from(blob.buffer),
        extension,
      });
    },
    [projectId]
  );

  // Action add frame
  const actionAddFrame = useCallback(
    async (trackId, frameBlob, beforeFrameId = false, backgroundBlob = null, extra = {}) => {
      const sceneId = Number(trackId);
      const addedPicture = await actionSavePicture(trackId, frameBlob);
      let backgroundPicture = null;
      if (backgroundBlob) {
        backgroundPicture = backgroundBlob;
      }

      setProjectData((oldData) => {
        let d = structuredClone(oldData);
        if (d.project.scenes[sceneId]) {
          const newIds = [v4(), v4(), v4()];
          const index = beforeFrameId === false ? -1 : d.project.scenes[sceneId].pictures.findIndex((f) => `${f.id}` === `${beforeFrameId}`);
          const frameToAdd = {
            ...addedPicture,
            ...extra,
            ...(backgroundPicture && {
              masking: {
                background: { ...backgroundPicture, id: newIds[1] },
                foreground: { ...addedPicture, id: newIds[2] },
                transparent: null,
              },
            }),
          };

          if (index >= 0) {
            d.project.scenes[sceneId].pictures = [...d.project.scenes[sceneId].pictures.slice(0, index), { ...frameToAdd, id: newIds[0] }, ...d.project.scenes[sceneId].pictures.slice(index)];
          } else {
            d.project.scenes[sceneId].pictures = [...d.project.scenes[sceneId].pictures, { ...frameToAdd, id: newIds[0] }];
            // View snapshots taken while posing this frame now belong to it
            const views = d.project.scenes[sceneId].perspectiveViews;
            if (views?.live) {
              d.project.scenes[sceneId].perspectiveViews = { ...views, [newIds[0]]: views.live, live: {} };
            }
          }
        }
        return d;
      });
    },
    [projectId, actionSavePicture]
  );

  // Action replace a frame's picture in place (same position, hold and note). The old file stays on disk and is listed in `replaced`.
  const actionReplaceFrame = useCallback(
    async (trackId, frameId, frameBlob, extra = {}) => {
      const sceneId = Number(trackId);
      const saved = await actionSavePicture(trackId, frameBlob);
      setProjectData((oldData) => {
        let d = structuredClone(oldData);
        if (d.project.scenes[sceneId]) {
          d.project.scenes[sceneId].pictures = d.project.scenes[sceneId].pictures.map((p) => {
            if (`${p.id}` !== `${frameId}`) return p;
            const kept = { ...p };
            // The old picture's masking layers and rotation belong to the old picture
            delete kept.masking;
            delete kept.sequence;
            delete kept.perspective;
            return {
              ...kept,
              ...saved,
              ...extra,
              id: p.id,
              replaced: [...(p.replaced || []), { filename: p.filename, sequenceFolder: p.sequence?.folder || null, at: new Date().toISOString() }],
            };
          });
        }
        return d;
      });
    },
    [actionSavePicture]
  );

  // Action save a live-view snapshot of the pose being worked on, as seen from one view (FRONT/RIGHT/BACK/LEFT)
  const actionSavePerspectiveView = useCallback(
    async (trackId, view, blob) => {
      const sceneId = Number(trackId);
      const saved = await window.EA('SAVE_REFERENCE_FRAME', {
        project_id: projectId,
        buffer: Buffer.from(await blob.arrayBuffer()),
        extension: 'jpg',
      });
      setProjectData((oldData) => {
        let d = structuredClone(oldData);
        const scene = d.project.scenes[sceneId];
        if (scene) {
          const views = scene.perspectiveViews || {};
          scene.perspectiveViews = { ...views, live: { ...(views.live || {}), [view]: { filename: saved.filename, link: saved.link } } };
        }
        return d;
      });
      return saved;
    },
    [projectId]
  );

  // Action import reference sequence: frames are copied into the project, then listed on the scene
  const actionImportReferenceSequence = useCallback(
    async (trackId, files, name, onProgress = () => {}, extra = {}) => {
      const sceneId = Number(trackId);
      const frames = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fromMime = mimeTypeToExtension(file.type);
        const extension = fromMime !== 'dat' ? fromMime : file.name.split('.').pop()?.toLowerCase() || 'jpg';
        const saved = await window.EA('SAVE_REFERENCE_FRAME', {
          project_id: projectId,
          buffer: Buffer.from(await file.arrayBuffer()),
          extension,
        });
        frames.push({ filename: saved.filename, link: saved.link });
        onProgress(i + 1, files.length);
      }
      const reference = { id: v4(), name, frames, enabled: true, opacity: 0.5, offset: 0, x: 0, y: 0, scale: 1, blendMode: 'normal', ...extra };
      setProjectData((oldData) => {
        let d = structuredClone(oldData);
        if (d.project.scenes[sceneId]) {
          d.project.scenes[sceneId].references = [...(d.project.scenes[sceneId].references || []), reference];
        }
        return d;
      });
      return reference;
    },
    [projectId]
  );

  // Action put a copy of a reference sequence on another timeline: the frames are the project's, so only
  // the record is copied, and the copy keeps its own fade, position, mirror and start frame
  const actionCopyReference = useCallback(async (fromTrackId, referenceId, toTrackId) => {
    const from = Number(fromTrackId);
    const to = Number(toTrackId);
    setProjectData((oldData) => {
      let d = structuredClone(oldData);
      const reference = (d.project.scenes[from]?.references || []).find((r) => r.id === referenceId);
      if (reference && d.project.scenes[to]) {
        d.project.scenes[to].references = [...(d.project.scenes[to].references || []), { ...structuredClone(reference), id: v4() }];
      }
      return d;
    });
  }, []);

  // Action update reference sequence display settings
  const actionUpdateReference = useCallback(async (trackId, referenceId, patch = {}) => {
    const sceneId = Number(trackId);
    setProjectData((oldData) => {
      let d = structuredClone(oldData);
      if (d.project.scenes[sceneId]) {
        d.project.scenes[sceneId].references = (d.project.scenes[sceneId].references || []).map((r) => (r.id === referenceId ? { ...r, ...patch } : r));
      }
      return d;
    });
  }, []);

  // Action remove reference sequence (files stay in the project folder, like deleted frames)
  const actionDeleteReference = useCallback(async (trackId, referenceId) => {
    const sceneId = Number(trackId);
    setProjectData((oldData) => {
      let d = structuredClone(oldData);
      if (d.project.scenes[sceneId]) {
        d.project.scenes[sceneId].references = (d.project.scenes[sceneId].references || []).filter((r) => r.id !== referenceId);
      }
      return d;
    });
  }, []);

  // Action Undo
  const actionUndo = useCallback(() => {
    const prev = historyUndo();
    if (prev) setProjectData(structuredClone(prev));
  }, [historyUndo]);

  // Action Redo
  const actionRedo = useCallback(() => {
    const next = historyRedo();
    if (next) setProjectData(structuredClone(next));
  }, [historyRedo]);

  return {
    project: projectData?.project || null,
    canUndo,
    canRedo,
    actions: {
      changeFPS: actionChangeFPS,
      changeRatio: actionChangeRatio,
      applyHiddenFrameStatus: actionApplyHiddenFrameStatus,
      applyDuplicateFrameOffset: actionApplyDuplicateFrameOffset,
      cloneFrame: actionCloneFrame,
      deleteFrame: actionDeleteFrame,
      deleteFrames: actionDeleteFrames,
      setFrameNote: actionSetFrameNote,
      setFrameSequence: actionSetFrameSequence,
      clearViewShots: actionClearViewShots,
      replaceFrame: actionReplaceFrame,
      rename: actionRename,
      moveFrame: actionMoveFrame,
      addFrame: actionAddFrame,
      savePicture: actionSavePicture,
      updateFrame: actionUpdateFrame,
      addScene: actionAddScene,
      renameScene: actionRenameScene,
      deleteScene: actionDeleteScene,
      importReferenceSequence: actionImportReferenceSequence,
      savePerspectiveView: actionSavePerspectiveView,
      updateReference: actionUpdateReference,
      copyReference: actionCopyReference,
      deleteReference: actionDeleteReference,
      undo: actionUndo,
      redo: actionRedo,
    },
  };
}

export default useProject;
