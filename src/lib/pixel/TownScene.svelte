<script lang="ts">
	import { onMount } from 'svelte';
	import type { Line } from '$lib/core/enums';
	import type { Game } from '$lib/game.svelte';
	import { SHEETS, SPRITES, type SheetName } from './atlas';
	import {
		DISTRICT_NAME,
		DISTRICT_OF,
		DISTRICTS,
		districtsWithEvents,
		dynamicLayer,
		FPS,
		H,
		hitTest,
		nightAlpha,
		staticLayer,
		W,
		type District,
		type DrawOp,
		type SceneState
	} from './scene';

	let { game, onpick }: { game: Game; onpick?: (line: Line) => void } = $props();

	let canvas = $state<HTMLCanvasElement>();
	let box = $state<HTMLDivElement>();
	let scale = $state(2);


	const lineOf = (templateId: string) => game.catalog?.templates.find((t) => t.id === templateId)?.line as Line | undefined;

	// 화면 상태 → 장면 상태 (진행 중인 작업, 사건, 낮밤)
	const scene = $derived<SceneState>({
		activeLine:
			(game.boardRun ? lineOf(game.boardRun.template) : undefined) ??
			(game.resting ? undefined : (game.slots.find((s) => s.template)?.line as Line | undefined)) ??
			null,
		eventLines: game.chainPostings.map((p) => p.line as Line),
		townTick: game.player?.town_tick ?? 0,
		levels: (game.player?.buildings ?? {}) as SceneState['levels'],
		fame: (game.player?.fame ?? {}) as SceneState['fame']
	});

	/** 보고 있는 구역. 고르지 않았으면 지금 일하는 계열의 구역 */
	let picked = $state<District | null>(null);
	const district = $derived<District>(picked ?? (scene.activeLine ? DISTRICT_OF[scene.activeLine] : 'center'));
	const eventDistricts = $derived(districtsWithEvents(scene.eventLines));
	const move = (step: number) => (picked = DISTRICTS[(DISTRICTS.indexOf(district) + step + DISTRICTS.length) % DISTRICTS.length]);

	onMount(() => {
		const ctx = canvas!.getContext('2d')!;
		const images = {} as Record<SheetName, HTMLImageElement>;
		let loaded = 0;
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
		let visible = true;
		let raf = 0;
		let last = 0;

		const draw = (ops: DrawOp[]) => {
			for (const op of ops) {
				if (op.rect) {
					ctx.fillStyle = op.rect.color;
					ctx.fillRect(op.x, op.y, op.rect.w, op.rect.h);
					continue;
				}
				const s = SPRITES[op.sprite!];
				ctx.drawImage(images[s.sheet], s.x, s.y, s.w, s.h, op.x, op.y, s.w, s.h);
			}
		};
		const render = (t: number) => {
			if (loaded < Object.keys(SHEETS).length) return;
			ctx.imageSmoothingEnabled = false;
			draw(staticLayer(district, scene.levels, scene.fame));
			draw(dynamicLayer(scene, reduced ? 0 : t, district));
			const a = nightAlpha(scene.townTick);
			if (a) {
				ctx.fillStyle = `rgba(16, 24, 48, ${a})`;
				ctx.fillRect(0, 0, W, H);
			}
		};
		const loop = (now: number) => {
			raf = requestAnimationFrame(loop);
			if (!visible || document.hidden || now - last < 1000 / FPS) return; // 보일 때만, 초당 12프레임
			last = now;
			render(now / 1000);
		};

		for (const [name, url] of Object.entries(SHEETS) as [SheetName, string][]) {
			const img = new Image();
			img.onload = () => {
				loaded++;
				render(performance.now() / 1000);
			};
			img.src = url;
			images[name] = img;
		}
		if (!reduced) raf = requestAnimationFrame(loop);

		const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
		io.observe(canvas!);
		const ro = new ResizeObserver(([e]) => (scale = Math.max(1, Math.floor(e.contentRect.width / W))));
		ro.observe(box!);
		// 동작 줄이기 설정이면 상태가 바뀔 때만 다시 그린다
		const stop = $effect.root(() => {
			$effect(() => {
				void scene.activeLine;
				void scene.eventLines.length;
				void scene.townTick;
				void JSON.stringify(scene.levels);
				void JSON.stringify(scene.fame);
				void district;
				if (reduced) render(0);
			});
		});
		return () => {
			cancelAnimationFrame(raf);
			io.disconnect();
			ro.disconnect();
			stop();
		};
	});

	function pick(e: MouseEvent) {
		const r = canvas!.getBoundingClientRect();
		const line = hitTest(((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H, district);
		if (line) onpick?.(line);
	}
</script>

<div class="scene" bind:this={box}>
	<!-- 장면은 보기 전용: 같은 정보가 아래 패널에 글자로 있다 -->
	<canvas
		bind:this={canvas}
		width={W}
		height={H}
		style:width="{W * scale}px"
		style:height="{H * scale}px"
		aria-hidden="true"
		onclick={pick}
	></canvas>
	<button class="nav prev" aria-label="이전 구역" onclick={() => move(-1)}>◀</button>
	<button class="nav next" aria-label="다음 구역" onclick={() => move(1)}>▶</button>
	<div class="where" aria-live="polite">
		<span class="name">{DISTRICT_NAME[district]}</span>
		{#each DISTRICTS as d (d)}
			<button
				class="dot"
				class:on={d === district}
				class:event={eventDistricts.has(d) && d !== district}
				aria-label="{DISTRICT_NAME[d]}{eventDistricts.has(d) ? ' (사건 있음)' : ''}"
				aria-current={d === district}
				onclick={() => (picked = d)}
			></button>
		{/each}
	</div>
</div>

<style>
	.scene {
		position: relative;
		display: flex;
		justify-content: center;
		margin: 0 -16px; /* 화면 가장자리까지 */
		background: var(--surface);
		border-bottom: 1px solid var(--line);
	}
	.nav {
		position: absolute;
		top: 50%;
		transform: translateY(-50%);
		width: 44px;
		height: 44px;
		border-radius: 50%;
		background: color-mix(in srgb, var(--surface) 80%, transparent);
		color: var(--ink);
		font-size: 14px;
	}
	.prev {
		left: 4px;
	}
	.next {
		right: 4px;
	}
	.where {
		position: absolute;
		bottom: 6px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 2px 10px;
		border-radius: 12px;
		background: color-mix(in srgb, var(--surface) 85%, transparent);
	}
	.where .name {
		font-size: 12px;
		font-weight: 700;
		margin-right: 2px;
	}
	.dot {
		width: 8px;
		height: 8px;
		min-height: 0;
		padding: 0;
		border-radius: 50%;
		background: var(--line);
	}
	.dot.on {
		background: var(--ink);
	}
	.dot.event {
		background: var(--event);
	}
	canvas {
		display: block;
		image-rendering: pixelated;
		cursor: pointer;
	}
</style>
