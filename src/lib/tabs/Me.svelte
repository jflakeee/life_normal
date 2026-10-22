<script lang="ts">
	import { RANK_NAME, xpToNext } from '$lib/format';
	import type { Game } from '$lib/game.svelte';

	let { game }: { game: Game } = $props();
	const p = $derived(game.player!);
	const lines = $derived(game.catalog!.lines);
	const order = $derived(Object.keys(lines).filter((l) => l !== 'COLLECTING'));
</script>

<div class="stack">
	{#each order as line (line)}
		{@const sk = p.skills[line]}
		{@const job = p.jobs[line]}
		{@const dex = game.collection[line]}
		<section class="panel stack line">
			<div class="row">
				<h2>{lines[line]}{job ? ` · ${RANK_NAME[job.rank]}` : ''}</h2>
				<span class="num quiet">Lv {sk.level}</span>
			</div>
			<div class="bar" aria-label="경험치 {sk.xp}/{xpToNext(sk.level)}">
				<span style:width="{Math.min(100, (sk.xp / xpToNext(sk.level)) * 100)}%"></span>
			</div>
			{#if job}
				{#if job.missing.length === 0}
					<button class="secondary" disabled={game.busy} onclick={() => game.promote(line)}>승급하기</button>
				{:else if job.rank !== 'CHIEF'}
					<p class="quiet">다음 승급까지: {job.missing.join(', ')}</p>
				{/if}
			{:else if sk.level >= 5}
				<button class="secondary" disabled={game.busy} onclick={() => game.takeJob(line)}>{lines[line]} 직업 시작</button>
			{:else}
				<p class="quiet">Lv 5가 되면 직업을 가질 수 있어요</p>
			{/if}
			{#if dex}
				<p class="quiet num">도감 {dex.owned}/{dex.total} · 경험치 ×{dex.xp_mult.toFixed(2)}</p>
			{/if}
		</section>
	{/each}
	<section class="panel">
		<h2>수집 Lv {p.skills.COLLECTING.level}</h2>
		<p class="quiet">표본 수집으로 도감을 채우면 그 계열 경험치가 늘어나요. 계열을 모두 모으면 +10%를 더 받습니다</p>
	</section>
	<p class="quiet">게스트 계정은 이 기기에만 저장됩니다</p>
</div>
