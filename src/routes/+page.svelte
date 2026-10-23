<script lang="ts">
	import { onMount } from 'svelte';
	import AwaySheet from '$lib/components/AwaySheet.svelte';
	import { gold } from '$lib/format';
	import { Game } from '$lib/game.svelte';
	import { createLocalBackend } from '$lib/local/backend';
	import Home from '$lib/tabs/Home.svelte';
	import Me from '$lib/tabs/Me.svelte';
	import Missions from '$lib/tabs/Missions.svelte';
	import Shop from '$lib/tabs/Shop.svelte';
	import Town from '$lib/tabs/Town.svelte';

	const TABS = [
		{ id: 'home', name: '홈' },
		{ id: 'missions', name: '임무' },
		{ id: 'town', name: '마을' },
		{ id: 'shop', name: '상점' },
		{ id: 'me', name: '나' }
	] as const;
	type Tab = (typeof TABS)[number]['id'];

	const game = new Game(createLocalBackend());
	let tab = $state<Tab>((location.hash.slice(1) as Tab) || 'home');
	let failed = $state<string | null>(null);

	onMount(() => {
		game.start().catch((e) => (failed = e.message ?? '게임을 불러오지 못했습니다'));
		// 주소의 #탭이 바뀌면(뒤로 가기 포함) 탭도 따라간다
		const sync = () => (tab = (location.hash.slice(1) as Tab) || 'home');
		addEventListener('hashchange', sync);
		return () => removeEventListener('hashchange', sync);
	});

	function go(t: Tab) {
		tab = t;
		history.replaceState(null, '', `#${t}`);
		void game.refresh().catch(() => {});
		scrollTo({ top: 0 });
	}
</script>

<header inert={!!game.away}>
	<h1>동네 임무</h1>
	{#if game.player}<span class="money num">{gold(game.player.money)}</span>{/if}
</header>

<main inert={!!game.away}>
	{#if failed}
		<div class="panel stack">
			<h2>게임을 불러오지 못했어요</h2>
			<p class="quiet">{failed}</p>
			<button class="primary" onclick={() => location.reload()}>다시 시도</button>
		</div>
	{:else if !game.player || !game.catalog}
		<p class="quiet loading">불러오는 중</p>
	{:else if tab === 'home'}
		<Home {game} />
	{:else if tab === 'missions'}
		<Missions {game} />
	{:else if tab === 'town'}
		<Town {game} />
	{:else if tab === 'shop'}
		<Shop {game} />
	{:else}
		<Me {game} />
	{/if}
</main>

{#if !game.online}<p class="offline">연결이 끊겼어요. 다시 연결하는 중</p>{/if}
{#if game.toast}<p class="toast" role="status">{game.toast}</p>{/if}
{#if game.away}<AwaySheet {game} />{/if}

<nav aria-label="탭" inert={!!game.away}>
	{#each TABS as t (t.id)}
		<button class:on={tab === t.id} aria-current={tab === t.id ? 'page' : undefined} onclick={() => go(t.id)}>
			{t.name}
			{#if t.id === 'home' && game.claimable}<span class="dot" aria-label="받을 보상 있음"></span>{/if}
		</button>
	{/each}
</nav>

<style>
	header {
		position: sticky;
		top: env(safe-area-inset-top, 0px);
		z-index: 5;
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		padding: 14px 16px 10px;
		background: var(--paper);
	}
	:global(body)::before {
		content: '';
		position: fixed;
		inset: 0 0 auto;
		height: env(safe-area-inset-top, 0px);
		z-index: 10;
		background: var(--paper);
	}
	h1,
	.money {
		font-family: var(--pixel-title);
		font-size: 22px;
		font-weight: 700;
		line-height: 1;
	}
	main {
		max-width: 560px;
		margin: 0 auto;
		padding: 4px 16px calc(var(--tabbar) + 28px);
	}
	.loading {
		padding: 40px 0;
		text-align: center;
	}
	nav {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		z-index: 5;
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		height: calc(var(--tabbar) + env(safe-area-inset-bottom, 0px));
		padding-bottom: env(safe-area-inset-bottom, 0px);
		background: var(--surface);
		border-top: 1px solid var(--line);
	}
	nav button {
		position: relative;
		color: var(--ink-2);
		font-size: 14px;
	}
	nav button.on {
		color: var(--action);
		font-weight: 700;
	}
	.dot {
		position: absolute;
		top: 12px;
		margin-left: 2px;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--seal);
	}
	.toast,
	.offline {
		position: fixed;
		left: 16px;
		right: 16px;
		bottom: calc(var(--tabbar) + env(safe-area-inset-bottom, 0px) + 12px);
		z-index: 6;
		margin: 0 auto;
		max-width: 528px;
		padding: 12px 16px;
		border-radius: 12px;
		background: var(--ink);
		color: var(--paper);
		font-size: 14px;
	}
	.offline {
		background: var(--event-bg);
		color: var(--ink);
		border: 1px solid var(--event);
	}
</style>
