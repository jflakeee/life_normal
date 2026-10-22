<script lang="ts">
	import StampCard from '$lib/components/StampCard.svelte';
	import TownScene from '$lib/pixel/TownScene.svelte';
	import { clock } from '$lib/format';
	import type { Game } from '$lib/game.svelte';

	let { game }: { game: Game } = $props();
	const p = $derived(game.player!);
	const cat = $derived(game.catalog!);
</script>

<div class="stack">
	<TownScene {game} onpick={() => (location.hash = '#missions')} />
	<StampCard runs={game.queueRuns} now={game.now} limit={cat.queue_limit} seconds={cat.mission_seconds} />
	<button class="primary" disabled={game.busy || game.claimable === 0} onclick={() => game.claim()}>
		{game.claimable ? `보상 받기 (${game.claimable}건)` : '받을 보상 없음'}
	</button>

	{#if game.boardRun}
		<div class="panel row">
			<div>
				<h2>{game.boardRun.name}</h2>
				<p class="quiet">수락한 임무</p>
			</div>
			<span class="num">{game.boardRun.ends_at <= game.now ? '완료' : clock(game.boardRun.ends_at - game.now)}</span>
		</div>
	{/if}

	{#each game.chainPostings as e (e.id)}
		<div class="event row">
			<div>
				<h2>{e.chain}: {e.name}</h2>
				<p class="quiet">보상 {e.reward} G · 기한 {e.deadline_ticks * 3}분</p>
			</div>
			{#if e.accepted}
				<span class="quiet">진행 중</span>
			{:else}
				<button class="secondary" disabled={!e.available || game.busy} onclick={() => game.accept(e.id)}>
					{e.available ? '수락' : '조건 부족'}
				</button>
			{/if}
		</div>
	{/each}

	{#if p.businesses.length}
		<div class="panel row">
			<div>
				<h2>사업 정산</h2>
				<p class="quiet num">받을 정산 {p.pending_settlements}회 · 하루 최대 {cat.business.settlements_per_day}회</p>
			</div>
			<button class="secondary" disabled={!p.pending_settlements || game.busy} onclick={() => game.collect()}>정산 받기</button>
		</div>
	{/if}
</div>
