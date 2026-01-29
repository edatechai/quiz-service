
import mongoose from 'mongoose';

const MONGO_URL = 'mongodb://localhost:27017/edat-quiz';

const GameLeaderboardSchema = new mongoose.Schema({
    schoolId: String,
    schoolName: String,
    teamName: String,
    totalScore: Number,
    roundsPlayed: Number,
    roundScores: mongoose.Schema.Types.Mixed,
    answers: mongoose.Schema.Types.Mixed,
    meta: mongoose.Schema.Types.Mixed,
});

const GameLeaderboard = mongoose.model('GameLeaderboard', GameLeaderboardSchema);

async function run() {
    try {
        await mongoose.connect(MONGO_URL);
        console.log('Connected to MongoDB');

        const teams = await GameLeaderboard.find({ schoolId: { $ne: 'admin' } }).lean();

        if (teams.length === 0) {
            console.log('No team data found.');
            process.exit(0);
        }

        // Check if ANY team has answers
        const teamsWithAnswers = teams.filter(t => t.answers && Object.keys(t.answers).length > 0);
        console.log(`Teams with answers: ${teamsWithAnswers.length} / ${teams.length}`);

        if (teamsWithAnswers.length > 0) {
            console.log('Sample answer from first team with answers:');
            const sampleTeam = teamsWithAnswers[0];
            const firstKey = Object.keys(sampleTeam.answers)[0];
            console.log(JSON.stringify(sampleTeam.answers[firstKey], null, 2));
        }

        // AI Usage for ALL teams to find if anyone used it
        const allAIUsage = teams.map(t => {
            let hintCount = 0;
            let fiftyFiftyCount = 0;
            if (t.answers) {
                for (const key in t.answers) {
                    const ans = t.answers[key];
                    if (ans.hintUsed || ans.usedHint || ans.hint) hintCount++;
                    if (ans.used5050 || ans.fiftyFiftyUsed) fiftyFiftyCount++;
                }
            }
            if (t.meta) {
                if (t.meta.hintCount) hintCount = Math.max(hintCount, t.meta.hintCount);
                if (t.meta.fiftyFiftyCount) fiftyFiftyCount = Math.max(fiftyFiftyCount, t.meta.fiftyFiftyCount);
            }
            return { schoolName: t.schoolName, hintCount, fiftyFiftyCount };
        }).filter(u => u.hintCount > 0 || u.fiftyFiftyCount > 0);

        console.log('TEAMS_WITH_AI_USAGE:');
        console.log(JSON.stringify(allAIUsage, null, 2));

        // Sort by totalScore
        const sortedTeams = [...teams].sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));
        const top3 = sortedTeams.slice(0, 3);

        const report = {
            winner: top3[0],
            top3: top3.map(t => ({
                schoolName: t.schoolName,
                teamName: t.teamName,
                totalScore: t.totalScore
            })),
            rounds: {},
            winnersAIUsage: []
        };

        // Round performance
        for (let r = 0; r < 5; r++) {
            const roundTeams = teams.map(t => ({
                schoolName: t.schoolName,
                score: (t.roundScores && t.roundScores[r.toString()]) || 0
            })).sort((a, b) => b.score - a.score);

            report.rounds[r] = roundTeams.slice(0, 3);
        }

        // AI Usage for winners
        report.winnersAIUsage = top3.map(t => {
            let hintCount = 0;
            let fiftyFiftyCount = 0;

            if (t.answers) {
                for (const key in t.answers) {
                    const ans = t.answers[key];
                    if (ans.hintUsed || ans.usedHint || ans.hint) hintCount++;
                    if (ans.used5050 || ans.fiftyFiftyUsed) fiftyFiftyCount++;
                }
            }

            if (t.meta) {
                if (t.meta.hintCount) hintCount = Math.max(hintCount, t.meta.hintCount);
                if (t.meta.fiftyFiftyCount) fiftyFiftyCount = Math.max(fiftyFiftyCount, t.meta.fiftyFiftyCount);
            }

            return {
                schoolName: t.schoolName,
                hintUsage: hintCount,
                fiftyFiftyUsage: fiftyFiftyCount,
                totalAIUsage: hintCount + fiftyFiftyCount
            };
        });

        console.log('FULL_REPORT_START');
        console.log(JSON.stringify(report, null, 2));
        console.log('FULL_REPORT_END');

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

run();
