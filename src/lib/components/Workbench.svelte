<script lang="ts">
	import { clock } from '$lib/format';
	import type { Game } from '$lib/game.svelte';

	let { game }: { game: Game } = $props();
	const w = $derived(game.player!.workbench);
	const mission = $derived(game.catalog!.mission_seconds);
	const elapsed = $derived(game.now - game.player!.now); // 마지막 스냅숏 이후 흐른 시간
	const left = (nextIn: number) => (((nextIn - elapsed) % mission) + mission) % mission || mission;
	const lockedReason = (i: number) => (i === 1 ? '직업을 가지면 열려요' : '사업을 열면 열려요');
	// 도장 칸을 손으로 찍은 듯 조금씩 다른 각도로
	const tilt = (i: number) => ((i * 37) % 17) - 8;
</script>

<section class="card" aria-label="작업대">
	<div class="row">
		<h2>작업대</h2>
		<span class="quiet num">오늘 {w.used_today}/{w.limit}건</span>
	</div>
	<div class="day" aria-hidden="true">
		<span class="used" style:width="{Math.min(1, w.used_today / w.limit) * 100}%"></span>
		<span class="mark" style:left="{(w.full / w.limit) * 100}%"></span>
	</div>
	<p class="quiet">
		{#if game.resting}
			오늘 한도에 닿아 쉬는 중이에요. 새벽 4시에 다시 시작해요
		{:else if w.used_today >= w.full}
			{w.full}건이 넘어서 지금부터는 보상이 {Math.round(w.over_rate * 100)}%예요
		{:else}
			앱을 닫아도 최대 {w.offline_cap_hours}시간 동안 계속 일해요{game.slots.some((x) => x.template)
				? '. 동그라미를 누르면 10초씩 빨라져요'
				: ''}
		{/if}
	</p>

	{#each w.slots as s (s.index)}
		{#if s.unlocked}
			<div class="slot">
				<button
					class="ring"
					style:--p={s.template ? 1 - left(s.next_in!) / mission : 0}
					disabled={!s.template || s.tap_left <= 0 || game.resting}
					aria-label={s.template ? `탭해서 10초 당기기: ${s.name}, 남은 ${clock(left(s.next_in!))}` : '빈 작업대'}
					onclick={() => game.tapWork(s.index)}
				>
					{s.name?.slice(0, 1) ?? '·'}
				</button>
				<div class="info">
					<p class="name">{s.name ?? '비어 있음'}</p>
					{#if s.template}
						<p class="quiet num">다음 완료 {clock(left(s.next_in!))}</p>
					{:else}
						<p class="quiet">임무 탭에서 올리세요</p>
					{/if}
					{#if s.pending}
						<div class="stamps" aria-label="받을 작업 {s.pending}건">
							{#each Array(Math.min(s.pending, 8)) as _, i (i)}<span class="seal" style:rotate="{tilt(i)}deg"></span>{/each}
							{#if s.pending > 8}<span class="quiet num">+{s.pending - 8}</span>{/if}
						</div>
					{/if}
				</div>
				{#if s.template}
					<button class="stop" onclick={() => game.stopWork(s.index)} disabled={game.busy}>비우기</button>
				{/if}
			</div>
		{:else}
			<div class="slot locked"><span class="quiet">작업대 {s.index + 1} · {lockedReason(s.index)}</span></div>
		{/if}
	{/each}
</section>

<style>
	.card {
		display: grid;
		gap: 10px;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 18px;
		padding: 16px;
	}
	.day {
		position: relative;
		height: 8px;
		border-radius: 4px;
		background: var(--line);
		overflow: hidden;
	}
	.used {
		position: absolute;
		inset: 0 auto 0 0;
		background: var(--action);
	}
	.mark {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 2px;
		background: var(--surface);
	}
	.slot {
		display: flex;
		align-items: center;
		gap: 12px;
		padding-top: 10px;
		border-top: 1px solid var(--line);
	}
	.slot.locked {
		border-top-style: dashed;
		min-height: 44px;
	}
	.ring {
		flex: none;
		width: 52px;
		height: 52px;
		border-radius: 50%;
		font-weight: 700;
		background:
			radial-gradient(var(--surface) 58%, transparent 60%),
			conic-gradient(var(--action) calc(var(--p) * 360deg), var(--line) 0);
	}
	.ring:disabled {
		opacity: 1;
	}
	.info {
		flex: 1;
		min-width: 0;
	}
	.name {
		font-weight: 700;
	}
	.stamps {
		display: flex;
		align-items: center;
		gap: 3px;
		margin-top: 4px;
	}
	.seal {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: var(--seal);
	}
	.stop {
		color: var(--ink-2);
		font-size: 13px;
		padding: 0 4px;
	}
</style>
