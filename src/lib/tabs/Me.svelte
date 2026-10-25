<script lang="ts">
	import { RANK_NAME, xpToNext } from '$lib/format';
	import type { Game } from '$lib/game.svelte';

	let { game }: { game: Game } = $props();
	let picker = $state<HTMLInputElement>();
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
			<div class="row fame">
				<span class="quiet">명성</span>
				<div class="bar seal" aria-label="명성 {p.fame[line] ?? 0}/100">
					<span style:width="{p.fame[line] ?? 0}%"></span>
				</div>
				<span class="num quiet">{p.fame[line] ?? 0}</span>
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
		<p class="quiet">명성은 의뢰를 끝내면 +1, 기한 절반 안이면 +1 더, 연계 이벤트 단계는 +3이에요. 책임 승급에는 그 계열 명성 80이 필요해요. 예술·음악·운동은 명성이 높을수록 보상이 커져요 (명성 100이면 1.5배). 예술은 레벨이 오를수록 걸작이 잘 나오고, 운동 경기는 레벨이 높을수록 잘 이겨요. 수락한 의뢰를 포기하면 명성이 3 줄어요</p>
	</section>
	{#if game.canTransfer}
		<section class="panel stack">
			<h2>세이브</h2>
			<p class="quiet">진행은 이 브라우저에만 저장돼요. 다른 기기로 옮기거나 백업하려면 파일로 내보내세요</p>
			<div class="row">
				<button class="secondary grow" onclick={() => game.exportSave()}>내보내기</button>
				<button class="secondary grow" onclick={() => picker?.click()}>가져오기</button>
			</div>
			<input
				bind:this={picker}
				type="file"
				accept="application/json,.json"
				hidden
				onchange={(e) => {
					const f = e.currentTarget.files?.[0];
					if (f && confirm('지금 진행을 이 세이브로 바꿀까요? 지금 진행은 사라집니다')) void game.importSave(f);
					e.currentTarget.value = '';
				}}
			/>
			<button
				class="danger"
				onclick={() => confirm('처음부터 다시 시작할까요? 지금 진행은 사라집니다') && game.resetSave()}
			>
				처음부터 다시
			</button>
		</section>
	{/if}
</div>

<style>
	.fame .bar {
		flex: 1;
	}
	.bar.seal > span {
		background: var(--seal);
	}
	.grow {
		flex: 1;
	}
	.danger {
		color: var(--seal);
		font-size: 14px;
	}
</style>
