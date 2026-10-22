<script lang="ts">
	import { clock } from '$lib/format';
	import type { Run } from '$lib/types';

	let { runs, now, limit, seconds }: { runs: Run[]; now: number; limit: number; seconds: number } = $props();

	const slots = $derived(
		Array.from({ length: limit }, (_, i) => {
			const r = runs[i];
			if (!r) return { kind: 'empty' as const };
			if (r.ends_at <= now) return { kind: 'done' as const, r };
			const started = r.ends_at - seconds;
			if (started <= now) return { kind: 'running' as const, r, p: (now - started) / seconds };
			return { kind: 'waiting' as const, r };
		})
	);
	const next = $derived(runs.find((r) => r.ends_at > now));
	const last = $derived(runs.at(-1));
	// 도장마다 조금씩 다른 각도 (손으로 찍은 느낌, 같은 칸은 항상 같은 각도)
	const tilt = (i: number) => ((i * 37) % 17) - 8;
</script>

<section class="card" aria-label="대기열 도장판">
	<div class="grid">
		{#each slots as s, i (i)}
			<div class="slot {s.kind}" title={s.kind === 'empty' ? '빈 칸' : s.r.name}>
				{#if s.kind === 'done'}
					<span class="seal" style:rotate="{tilt(i)}deg" aria-label="완료: {s.r.name}">
						<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12.5l4 4 8-9" /></svg>
					</span>
				{:else if s.kind === 'running'}
					<span class="ring" style:--p={s.p} aria-label="진행 중: {s.r.name}">{s.r.name.slice(0, 1)}</span>
				{:else if s.kind === 'waiting'}
					<span class="wait" aria-label="대기: {s.r.name}">{s.r.name.slice(0, 1)}</span>
				{/if}
			</div>
		{/each}
	</div>
	<p class="status num">
		{#if next}
			다음 도장까지 {clock(next.ends_at - now)}, 다 찍히기까지 {clock((last?.ends_at ?? now) - now)}
		{:else if runs.length}
			모든 칸에 도장이 찍혔어요
		{:else}
			비어 있어요. 임무 탭에서 대기열을 채우세요
		{/if}
	</p>
</section>

<style>
	.card {
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 18px;
		padding: 18px 16px 14px;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		gap: 12px 8px;
		justify-items: center;
	}
	.slot {
		width: 46px;
		height: 46px;
		display: grid;
		place-items: center;
		border-radius: 50%;
	}
	.slot.empty {
		border: 1.5px dotted var(--line);
	}
	.seal {
		width: 46px;
		height: 46px;
		border-radius: 50%;
		background: var(--seal);
		display: grid;
		place-items: center;
		box-shadow: inset 0 0 0 3px color-mix(in srgb, var(--seal) 70%, white);
		animation: press 260ms ease-out;
	}
	.seal svg {
		width: 24px;
		fill: none;
		stroke: var(--surface);
		stroke-width: 3;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	@keyframes press {
		from {
			transform: scale(1.35);
			opacity: 0;
		}
	}
	.ring {
		width: 46px;
		height: 46px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		font-weight: 700;
		background:
			radial-gradient(var(--surface) 58%, transparent 60%),
			conic-gradient(var(--action) calc(var(--p) * 360deg), var(--line) 0);
	}
	.wait {
		width: 46px;
		height: 46px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		border: 1.5px dashed var(--ink-2);
		color: var(--ink-2);
		font-size: 14px;
	}
	.status {
		margin-top: 14px;
		text-align: center;
		color: var(--ink-2);
		font-size: 13px;
	}
</style>
