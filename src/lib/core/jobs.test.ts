import { describe, expect, it } from 'vitest';
import { entryJob, jobRewardMult, JOBS, jobsOf } from './jobs';
import { hourlyPay, jobTransferFee, newPlayer, RANK_REQ, takeJob, transferJob } from './model';

describe('jobs (직종)', () => {
	it('every line with a job has exactly one entry job', () => {
		for (const line of ['TRANSPORT', 'HUNTING', 'CONSTRUCTION', 'MEDICAL', 'SECURITY', 'ART', 'MUSIC', 'SPORT'] as const)
			expect(jobsOf(line).filter((j) => j.entry), line).toHaveLength(1);
		for (const j of Object.values(JOBS)) if (j.requires) expect(JOBS[j.requires.from], j.id).toBeDefined();
	});

	it('taking a job starts at the entry job of that line', () => {
		const p = newPlayer('p');
		p.skills.MEDICAL.level = 5;
		expect(() => takeJob(p, 'MEDICAL')).toThrow(/돌보기 1\/2/); // 행동 조건
		p.actions = { care: { level: 2, xp: 0 } };
		takeJob(p, 'MEDICAL');
		expect(p.jobs.MEDICAL!.job).toBe('nurse');
		expect(entryJob('CONSTRUCTION')!.name).toBe('목수');
	});

	it('transfer checks the path, rank and counts, drops a rank and charges a fee', () => {
		const p = newPlayer('p', 100_000);
		p.jobs.MEDICAL = { job: 'nurse', rank: 'APPRENTICE', jobMissions: 0, requestsDone: 0, processDone: 0 };
		expect(() => transferJob(p, 'MEDICAL', 'pharmacist')).toThrow(/직급 REGULAR 이상.*가공 0\/30건/);
		p.jobs.MEDICAL.rank = 'REGULAR';
		p.jobs.MEDICAL.processDone = 30;
		p.actions = { organize: { level: 4, xp: 0 }, observe: { level: 2, xp: 0 } };
		const fee = jobTransferFee(p, 'MEDICAL', 'pharmacist');
		expect(fee).toBe(RANK_REQ.REGULAR.fee / 2); // 견습으로 내려가므로 다음 승급(정규)비의 절반
		const before = p.money;
		expect(transferJob(p, 'MEDICAL', 'pharmacist')).toBe('APPRENTICE');
		expect(before - p.money).toBe(fee);
		expect(p.jobs.MEDICAL.job).toBe('pharmacist');
		expect(p.jobs.MEDICAL.jobMissions).toBe(0); // 바로 다시 승급할 수 없게 근무 실적은 처음부터
		expect(() => transferJob(p, 'MEDICAL', 'doctor')).toThrow(/간호사에서만 전직/);
		expect(transferJob(p, 'MEDICAL', 'nurse')).toBe('APPRENTICE'); // 진입 직종으로는 조건 없이 돌아갈 수 있다
	});

	it('doctor needs expert nurse, fame 50 and a 10,000 G training fee', () => {
		const p = newPlayer('p', 0);
		p.jobs.MEDICAL = { job: 'nurse', rank: 'EXPERT', jobMissions: 0, requestsDone: 0, processDone: 0 };
		p.fame.MEDICAL = 50;
		p.actions = { care: { level: 5, xp: 0 }, observe: { level: 4, xp: 0 } };
		const fee = jobTransferFee(p, 'MEDICAL', 'doctor');
		expect(fee).toBe(10_000 + RANK_REQ.EXPERT.fee / 2);
		expect(() => transferJob(p, 'MEDICAL', 'doctor')).toThrow(/전직비/);
		p.money = fee;
		expect(transferJob(p, 'MEDICAL', 'doctor')).toBe('REGULAR');
	});

	it('upper jobs pay more and do their specialty better', () => {
		const p = newPlayer('p');
		p.jobs.MEDICAL = { job: 'nurse', rank: 'REGULAR', jobMissions: 0, requestsDone: 0, processDone: 0 };
		const nurse = hourlyPay(p.jobs.MEDICAL);
		p.jobs.MEDICAL.job = 'pharmacist';
		expect(hourlyPay(p.jobs.MEDICAL) / nurse).toBeCloseTo(1.13);
		expect(jobRewardMult(p, 'MEDICAL', 'process_medicine')).toBe(1.3);
		expect(jobRewardMult(p, 'MEDICAL', 'treat')).toBe(1);
	});
});
