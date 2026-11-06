<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import * as MediaPipeVision from '@mediapipe/tasks-vision';
  import { mdiCameraOutline, mdiRefresh, mdiShieldCheckOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import { Icon } from '@immich/ui';
  import MyMulMeLogo from '#lib/components/MyMulMeLogo.svelte';
  import type { MyMulMeMatchAssetDto } from '@immich/sdk';
  import { searchMyMulMe } from '#lib/queries/my-mulme.query.ts';

  const pageSize = 24;
  const wasmUrl = '/mymulme-assets/mediapipe-wasm';
  const modelUrl = '/mymulme-assets/face-landmarker.task';

  type Point = { x: number; y: number };
  type LandmarkResults = { faceLandmarks?: Point[][] };
  type FaceLandmarkerInstance = {
    detectForVideo: (video: HTMLVideoElement, timestamp: number) => LandmarkResults;
    close: () => void;
  };
  type VisionModule = {
    FilesetResolver: { forVisionTasks: (url: string) => Promise<unknown> };
    FaceLandmarker: { createFromOptions: (fileset: unknown, options: object) => Promise<FaceLandmarkerInstance> };
  };

  let videoElement: HTMLVideoElement | undefined = $state();
  let stream: MediaStream | undefined;
  let landmarker: FaceLandmarkerInstance | undefined;
  let animationFrame = 0;
  let lastInference = 0;
  let eyeClosed = false;
  let lastBlinkAt = 0;
  let isCapturing = false;
  let startupStage: 'camera' | 'detector' = 'camera';
  let blinkCount = $state(0);
  let cameraState = $state<'off' | 'starting' | 'ready' | 'error'>('off');
  let cameraError = $state('');
  let capturedFile: File | undefined = $state();
  let previewUrl = $state('');
  let matches: MyMulMeMatchAssetDto[] = $state([]);
  let page = $state(1);
  let hasNextPage = $state(false);
  let isSearching = $state(false);
  let errorMessage = $state('');
  let statusMessage = $state('');

  const stopCamera = () => {
    cancelAnimationFrame(animationFrame);
    stream?.getTracks().forEach((track) => track.stop());
    stream = undefined;
    if (videoElement) videoElement.srcObject = null;
  };

  const eyeAspectRatio = (points: Point[], indices: number[]) => {
    const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
    const [outer, upperA, upperB, inner, lowerB, lowerA] = indices.map((index) => points[index]);
    if (!outer || !upperA || !upperB || !inner || !lowerB || !lowerA) return 1;
    return (distance(upperA, lowerA) + distance(upperB, lowerB)) / (2 * distance(outer, inner));
  };

  const checkBlink = (now: number) => {
    if (cameraState !== 'ready' || isCapturing || !videoElement || !landmarker) return;
    if (now - lastInference > 90 && videoElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      lastInference = now;
      try {
        const faces = landmarker.detectForVideo(videoElement, now).faceLandmarks ?? [];
        if (faces.length === 1) {
          const points = faces[0];
          const ratio = (eyeAspectRatio(points, [33, 160, 158, 133, 153, 144]) +
            eyeAspectRatio(points, [362, 385, 387, 263, 373, 380])) / 2;
          if (ratio < 0.19) eyeClosed = true;
          else if (eyeClosed && ratio > 0.23) {
            eyeClosed = false;
            if (now - lastBlinkAt > 250) {
              blinkCount = Math.min(2, blinkCount + 1);
              lastBlinkAt = now;
              statusMessage = blinkCount >= 2
                ? $t('mymulme_blink_complete')
                : $t('mymulme_blink_progress', { values: { count: blinkCount } });
              if (blinkCount >= 2) void captureSelfie();
            }
          }
          if (blinkCount === 0 && !eyeClosed) statusMessage = $t('mymulme_face_found');
        } else {
          statusMessage = faces.length > 1 ? $t('mymulme_one_face') : $t('mymulme_align_face');
          eyeClosed = false;
        }
      } catch (error) {
        console.error('[MyMulMe] Blink detection failed', error);
        const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        cameraError = $t('mymulme_detector_error', { values: { error: detail } });
        cameraState = 'error';
        stopCamera();
        return;
      }
    }
    animationFrame = requestAnimationFrame(checkBlink);
  };

  const startCamera = async () => {
    cameraError = '';
    cameraState = 'starting';
    blinkCount = 0;
    isCapturing = false;
    statusMessage = $t('mymulme_camera_starting');
    startupStage = 'camera';
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('camera-unavailable');
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 720 } },
      });
      await tick();
      if (!videoElement) throw new Error('video-unavailable');
      videoElement.srcObject = stream;
      await videoElement.play();

      startupStage = 'detector';
      const vision = MediaPipeVision as unknown as VisionModule;
      const fileset = await vision.FilesetResolver.forVisionTasks(wasmUrl);
      landmarker ??= await vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: modelUrl, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numFaces: 2,
        outputFaceBlendshapes: false,
      });
      cameraState = 'ready';
      statusMessage = $t('mymulme_align_face');
      animationFrame = requestAnimationFrame(checkBlink);
    } catch (error) {
      stopCamera();
      cameraState = 'error';
      const name = error instanceof Error ? error.name : 'UnknownError';
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      console.error(`[MyMulMe] ${startupStage} startup failed`, error);
      if (startupStage === 'detector') {
        cameraError = $t('mymulme_detector_error', { values: { error: detail } });
      } else if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        cameraError = $t('mymulme_camera_denied');
      } else if (name === 'NotFoundError') {
        cameraError = $t('mymulme_camera_missing');
      } else if (name === 'NotReadableError' || name === 'TrackStartError') {
        cameraError = $t('mymulme_camera_busy');
      } else {
        cameraError = $t('mymulme_camera_access_error', { values: { error: detail } });
      }
    }
  };

  const search = async (file: File, targetPage: number, append: boolean, revealResults = false) => {
    isSearching = true;
    errorMessage = '';
    if (revealResults) {
      await tick();
      document.getElementById('mymulme-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    try {
      const response = await searchMyMulMe({
        page: targetPage,
        size: pageSize,
        myMulMeMatchUploadDto: { file },
      });
      matches = append ? [...matches, ...response.items] : response.items;
      page = targetPage;
      hasNextPage = response.hasNextPage;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : $t('mymulme_error');
    } finally {
      isSearching = false;
    }
  };

  const captureSelfie = async () => {
    if (isCapturing || !videoElement || cameraState !== 'ready' || blinkCount < 2) return;
    isCapturing = true;
    const canvas = document.createElement('canvas');
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;
    canvas.getContext('2d')?.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    if (!blob) {
      isCapturing = false;
      cameraError = $t('mymulme_capture_error');
      return;
    }
    capturedFile = new File([blob], 'mymulme-selfie.jpg', { type: 'image/jpeg' });
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(blob);
    stopCamera();
    cameraState = 'off';
    matches = [];
    page = 1;
    hasNextPage = false;
    statusMessage = '';
    await search(capturedFile, 1, false, true);
  };

  const retake = () => {
    capturedFile = undefined;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = '';
    matches = [];
    errorMessage = '';
    cameraError = '';
    blinkCount = 0;
    isCapturing = false;
    cameraState = 'off';
  };

  const loadMore = () => {
    if (capturedFile && !isSearching) void search(capturedFile, page + 1, true);
  };

  onDestroy(() => {
    stopCamera();
    landmarker?.close();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  });
</script>

<svelte:head>
  <title>{$t('mymulme_title')}</title>
  <meta name="description" content={$t('mymulme_description')} />
</svelte:head>

<main class="mx-auto w-full max-w-7xl px-5 py-8 sm:px-8 lg:px-12 lg:py-12">
  <header class="mb-9 flex items-center gap-3">
    <MyMulMeLogo variant="inline" class="!h-12" />
    <span class="hidden border-l border-gray-200 pl-3 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400 sm:inline">
      {$t('mymulme_portal_label')}
    </span>
  </header>

  <section class="grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)] lg:items-stretch">
    <div class="flex flex-col justify-center rounded-3xl bg-gradient-to-br from-[#f5f1ff] via-white to-[#eafaff] p-7 dark:from-[#241637] dark:via-gray-900 dark:to-[#10242a] sm:p-10">
      <p class="mb-4 inline-flex w-fit items-center gap-2 rounded-full bg-white/80 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-indigo-700 shadow-sm dark:bg-gray-800 dark:text-indigo-300">
        <Icon icon={mdiShieldCheckOutline} size={16} />{$t('mymulme_private_label')}
      </p>
      <h1 class="max-w-xl text-4xl font-bold leading-tight tracking-tight text-gray-900 dark:text-white sm:text-5xl">{$t('mymulme_title')}</h1>
      <p class="mt-4 max-w-xl text-base leading-7 text-gray-600 dark:text-gray-300 sm:text-lg">{$t('mymulme_description')}</p>
      <div class="mt-8 flex flex-wrap gap-3 text-sm">
        <span class="inline-flex items-center gap-2 rounded-xl border border-white/80 bg-white/70 px-4 py-3 text-gray-700 shadow-sm dark:border-gray-700 dark:bg-gray-800/70 dark:text-gray-200"><span class="grid size-6 place-items-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700 dark:bg-indigo-900 dark:text-indigo-200">1</span>{$t('mymulme_step_camera')}</span>
        <span class="inline-flex items-center gap-2 rounded-xl border border-white/80 bg-white/70 px-4 py-3 text-gray-700 shadow-sm dark:border-gray-700 dark:bg-gray-800/70 dark:text-gray-200"><span class="grid size-6 place-items-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700 dark:bg-indigo-900 dark:text-indigo-200">2</span>{$t('mymulme_step_blink')}</span>
        <span class="inline-flex items-center gap-2 rounded-xl border border-white/80 bg-white/70 px-4 py-3 text-gray-700 shadow-sm dark:border-gray-700 dark:bg-gray-800/70 dark:text-gray-200"><span class="grid size-6 place-items-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700 dark:bg-indigo-900 dark:text-indigo-200">3</span>{$t('mymulme_step_results')}</span>
      </div>
      <p class="mt-8 max-w-xl text-sm leading-6 text-gray-500 dark:text-gray-400">{$t('mymulme_privacy')}</p>
    </div>

    <section class="rounded-3xl border border-gray-200 bg-white p-5 shadow-xl shadow-indigo-950/5 dark:border-gray-700 dark:bg-gray-900 sm:p-7" aria-label={$t('mymulme_camera_panel')}>
      <div class="mb-5 flex items-start justify-between gap-4">
        <div><h2 class="text-xl font-semibold text-gray-900 dark:text-white">{$t('mymulme_camera_title')}</h2><p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{$t('mymulme_camera_subtitle')}</p></div>
        <span class="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">{#if cameraState === 'ready'}{$t('mymulme_camera_live')}{:else}{$t('mymulme_camera_private')}{/if}</span>
      </div>

      <div class="relative aspect-[4/3] overflow-hidden rounded-2xl bg-gray-950">
        {#if cameraState === 'ready' || cameraState === 'starting'}
          <video bind:this={videoElement} class="h-full w-full -scale-x-100 object-cover" autoplay muted playsinline></video>
          <div class="pointer-events-none absolute inset-0 grid place-items-center"><div class="h-[72%] w-[55%] rounded-[48%] border-2 border-white/80 shadow-[0_0_0_999px_rgba(4,9,20,0.2)]"></div></div>
          <span class="absolute left-4 top-4 inline-flex items-center gap-2 rounded-full bg-black/55 px-3 py-1.5 text-xs font-medium text-white"><span class="size-2 animate-pulse rounded-full bg-emerald-400"></span>{$t('mymulme_camera_live')}</span>
        {:else if previewUrl}
          <img src={previewUrl} alt={$t('mymulme_selfie_preview')} class="h-full w-full object-cover" />
        {:else}
          <div class="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-gray-800 via-gray-900 to-gray-950 px-8 text-center text-white"><MyMulMeLogo size="giant" class="mb-4 opacity-90" /><span class="text-sm text-gray-300">{$t('mymulme_camera_placeholder')}</span></div>
        {/if}
      </div>

      <div class="mt-4 flex min-h-12 items-center justify-between gap-4 rounded-xl bg-gray-50 px-4 py-3 dark:bg-gray-800">
        <p class="text-sm text-gray-600 dark:text-gray-300" aria-live="polite">{#if cameraError}{cameraError}{:else if statusMessage}{statusMessage}{:else if previewUrl && isSearching}{$t('mymulme_searching')}{:else}{$t('mymulme_blink_prompt')}{/if}</p>
        {#if cameraState === 'ready'}<span class="shrink-0 font-semibold tabular-nums text-indigo-700 dark:text-indigo-300">{blinkCount}/2</span>{/if}
      </div>

      <div class="mt-4 flex flex-wrap gap-3">
        {#if cameraState === 'ready'}
          <button class="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50" disabled={blinkCount < 2} onclick={captureSelfie}><Icon icon={mdiCameraOutline} size={20} />{$t('mymulme_capture')}</button>
          <button class="min-h-12 rounded-xl border border-gray-300 px-4 py-3 font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800" onclick={retake}>{$t('mymulme_cancel')}</button>
        {:else if previewUrl}
          <button class="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-gray-300 px-5 py-3 font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800" disabled={isSearching} onclick={retake}><Icon icon={mdiRefresh} size={20} />{$t('mymulme_try_another')}</button>
        {:else}
          <button class="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-60" disabled={cameraState === 'starting'} onclick={startCamera}><Icon icon={mdiCameraOutline} size={20} />{#if cameraState === 'starting'}{$t('mymulme_camera_starting')}{:else}{$t('mymulme_start_camera')}{/if}</button>
        {/if}
      </div>
      <p class="mt-4 text-xs leading-5 text-gray-500 dark:text-gray-400">{$t('mymulme_camera_disclosure')}</p>
    </section>
  </section>

  {#if previewUrl}
    <section id="mymulme-results" class="mt-10 scroll-mt-6" aria-labelledby="mymulme-matches">
      <div class="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div><p class="text-sm font-semibold uppercase tracking-widest text-indigo-600 dark:text-indigo-300">{$t('mymulme_results_eyebrow')}</p><h2 id="mymulme-matches" class="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{$t('mymulme_matches')}</h2></div>
        {#if matches.length > 0}<span class="rounded-full bg-gray-100 px-3 py-1.5 text-sm text-gray-600 dark:bg-gray-800 dark:text-gray-300">{$t('mymulme_results_count', { values: { count: matches.length } })}</span>{/if}
      </div>
      {#if isSearching}
        <div class="flex items-center justify-center gap-3 rounded-2xl bg-gray-50 px-6 py-10 text-gray-600 dark:bg-gray-900 dark:text-gray-300" role="status" aria-live="polite">
          <span class="size-5 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" aria-hidden="true"></span>
          <span>{$t('mymulme_searching')}</span>
        </div>
      {:else if errorMessage}
        <div class="rounded-xl border border-red-300 bg-red-50 p-4 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200" role="alert">{errorMessage}</div>
      {:else if matches.length > 0}
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {#each matches as match (match.assetId)}
            <figure class="group overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900">
              <div class="aspect-square overflow-hidden bg-gray-100 dark:bg-gray-800"><img src={match.thumbnail} alt={$t('mymulme_matches')} loading="lazy" class="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" /></div>
              <figcaption class="px-3 py-2.5 text-sm text-gray-600 dark:text-gray-300">{new Date(match.fileCreatedAt).toLocaleDateString()}</figcaption>
            </figure>
          {/each}
        </div>
      {:else}
        <div class="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-6 py-10 text-center dark:border-gray-700 dark:bg-gray-900"><p class="font-medium text-gray-800 dark:text-gray-200">{$t('mymulme_no_matches')}</p><p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{$t('mymulme_no_matches_hint')}</p></div>
      {/if}
      {#if hasNextPage}<div class="mt-7 text-center"><button class="rounded-xl border border-gray-300 px-6 py-3 font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800" disabled={isSearching} onclick={loadMore}>{$t('mymulme_show_more')}</button></div>{/if}
    </section>
  {/if}
</main>
