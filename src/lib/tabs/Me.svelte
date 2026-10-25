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
	<details class="panel actions" open>
		<summary><h2>일상 행동</h2></summary>
		<p class="quiet">같은 행동을 하루 10건씩 3일 이어 하면 습관이 돼요 (+10%, 7일이면 +20%)</p>
		<ul>
			{#each Object.entries(p.actions) as [id, a] (id)}
				<li>
					<span class="name">{a.name} <span class="num quiet">Lv {a.level}</span></span>
					<div class="bar" aria-label="{a.name} 경험치 {a.xp}/{a.next}"><span style:width="{Math.min(100, (a.xp / a.next) * 100)}%"></span></div>
					<span class="quiet num habit">{a.streak ? `습관 ${a.streak}일` : a.today ? `오늘 ${a.today}건` : ''}</span>
				</li>
			{/each}
		</ul>
	</details>

	{#each order as line (line)}
		{@const sk = p.skills[line]}
		{@const job = p.jobs[line]}
		{@const dex = game.collection[line]}
		<section class="panel stack line">
			<div class="row">
				<h2>{lines[line]}{job ? ` · ${job.job_name ?? ''} ${RANK_NAME[job.rank]}` : ''}</h2>
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
			{:else if p.job_entry[line]}
				{@const entry = p.job_entry[line]}
				{#if entry.missing.length === 0}
					<button class="secondary" disabled={game.busy} onclick={() => game.takeJob(line)}>{entry.job} 되기</button>
				{:else}
					<p class="quiet">{entry.job} 조건: {entry.missing.join(', ')}</p>
				{/if}
			{/if}
			{#if line === 'SEA' && p.notoriety.value > 0}
				<p class="outlaw">
					악명 {p.notoriety.value}{p.notoriety.wanted ? ' · 현상수배 중' : ''}{p.notoriety.ban_until && p.notoriety.ban_until > game.now
						? ` · 체포되어 ${Math.ceil((p.notoriety.ban_until - game.now) / 3600)}시간 동안 해적 일 금지`
						: ''}
				</p>
			{/if}
						{#if job && job.transfers.length}
				<details class="transfers">
					<summary>전직 ({job.transfers.map((t) => t.name).join(', ')})</summary>
					<p class="quiet">같은 계열 안에서 바꿔요. 숙련도·명성은 그대로, 직급은 한 단계 내려가요. 7일에 한 번</p>
					{#each job.transfers as t (t.job)}
						<div class="row">
							<div>
								<p><strong>{t.name}</strong> <span class="quiet num">급여 ×{t.pay_mult} · 전직비 {t.fee.toLocaleString('ko-KR')} G</span></p>
								{#if t.missing.length}<p class="quiet">{t.missing.join(', ')}</p>{/if}
							</div>
							<button class="secondary" disabled={t.missing.length > 0 || game.busy} onclick={() => game.transfer(line, t.job, t.name)}>전직</button>
						</div>
					{/each}
				</details>
			{/if}
			{#if dex}
				<p class="quiet num">도감 {dex.owned}/{dex.total} · 경험치 ×{dex.xp_mult.toFixed(2)}</p>
			{/if}
		</section>
	{/each}
	<section class="panel">
		<h2>수집 Lv {p.skills.COLLECTING.level}</h2>
		<p class="quiet">표본 수집으로 도감을 채우면 그 계열 경험치가 늘어나요. 계열을 모두 모으면 +10%를 더 받습니다</p>
		<p class="quiet">명성은 의뢰를 끝내면 +1, 기한 절반 안이면 +1 더, 연계 이벤트 단계는 +3이에요. 책임 승급에는 그 계열 명성 80이 필요해요. 예술·음악·운동은 명성이 높을수록 보상이 커져요 (명성 100이면 1.5배). 예술은 레벨이 오를수록 걸작이 잘 나오고, 운동 경기는 레벨이 높을수록 잘 이겨요. 수락한 의뢰를 포기하면 명성이 3 줄어요. 정규가 되면 같은 계열의 다른 직종(예: 간호사 → 약사, 의사)으로 전직할 수 있고, 상위 직종은 급여가 높고 잘하는 임무의 보상이 더 커요. 어부는 정규가 되면 보물 사냥꾼이나 해적이 될 수 있어요. 해적은 벌이가 크지만 악명이 쌓이고, 악명 30부터 현상수배되어 하루 한 번 형사에게 잡힐 수 있어요</p>
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
	.outlaw {
		color: var(--seal);
		font-weight: 600;
	}
	.actions summary {
		cursor: pointer;
		list-style: none;
	}
	.actions ul {
		list-style: none;
		margin: 8px 0 0;
		padding: 0;
		display: grid;
		gap: 8px;
	}
	.actions li {
		display: grid;
		grid-template-columns: 7.5em 1fr 4.5em;
		align-items: center;
		gap: 8px;
	}
	.actions .habit {
		text-align: right;
		font-size: 12px;
	}
	.transfers summary {
		cursor: pointer;
		color: var(--action);
		font-weight: 600;
		min-height: 44px;
		display: flex;
		align-items: center;
	}
	.transfers {
		display: grid;
		gap: 8px;
	}
	.transfers .row > div {
		min-width: 0;
	}
	.transfers button {
		flex: none;
		white-space: nowrap;
	}
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
