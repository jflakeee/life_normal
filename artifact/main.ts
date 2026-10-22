// 한 파일 빌드 진입점: SvelteKit 없이 같은 화면(+page.svelte)을 띄운다 (claude.ai 아티팩트 등)
import { mount } from 'svelte';
import '../src/app.css';
import Page from '../src/routes/+page.svelte';

mount(Page, { target: document.getElementById('app')! });
