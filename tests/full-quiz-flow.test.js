/**
 * Full Quiz Flow Test
 * 
 * This test simulates a complete quiz from Round 1 to Round 5:
 * - Rounds 1-4: 5 questions each
 * - Round 5 (Sudden Death): 1 question
 * - Total: 21 questions
 * 
 * Usage: node tests/full-quiz-flow.test.js
 */

import 'dotenv/config';

const API_BASE = process.env.API_BASE_URL || 'http://localhost:5000';

// Test configuration
const ROUNDS = [
    { index: 0, name: 'Round 1', expectedQuestions: 5 },
    { index: 1, name: 'Round 2 (Inside The Box)', expectedQuestions: 5 },
    { index: 2, name: 'Round 3', expectedQuestions: 5 },
    { index: 3, name: 'Round 4', expectedQuestions: 5 },
    { index: 4, name: 'Round 5 (Sudden Death)', expectedQuestions: 1 },
];

const TEST_SCHOOL = {
    schoolId: 'test-school-quiz-flow',
    schoolName: 'Quiz Flow Test School',
    teamName: 'Test Team'
};

// Utility functions
async function fetchJson(url, options = {}) {
    const response = await fetch(`${API_BASE}${url}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options.headers,
        },
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
    }

    return response.json();
}

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// API wrapper functions
async function login() {
    return fetchJson('/api/auth/qr-login', {
        method: 'POST',
        body: JSON.stringify({
            type: 'school_login',
            schoolId: TEST_SCHOOL.schoolId,
            schoolName: TEST_SCHOOL.schoolName,
            coordinatorEmail: 'test@quiztest.com',
            region: 'Test Region',
            iat: Date.now(),
        }),
    });
}

async function resetQuiz() {
    return fetchJson('/api/game/reset', { method: 'POST' });
}

async function getQuizState() {
    return fetchJson('/api/game/quiz-state');
}

async function startRound(roundIndex) {
    return fetchJson('/api/game/round/start', {
        method: 'POST',
        body: JSON.stringify({ roundIndex }),
    });
}

async function getQuestions(limit, round) {
    return fetchJson(`/api/game/questions?limit=${limit}&round=${round}`);
}

async function updateQuizState(roundIndex, questionIndex, questionId) {
    return fetchJson('/api/game/quiz-state', {
        method: 'POST',
        body: JSON.stringify({ roundIndex, questionIndex, questionId }),
    });
}

async function submitAnswer(selectedOptionId) {
    return fetchJson('/api/game/answer', {
        method: 'POST',
        body: JSON.stringify({
            schoolId: TEST_SCHOOL.schoolId,
            schoolName: TEST_SCHOOL.schoolName,
            selectedOptionId,
        }),
    });
}

// Test runner
async function runFullQuizTest() {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('               FULL QUIZ FLOW TEST');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`API Base: ${API_BASE}`);
    console.log(`Test School: ${TEST_SCHOOL.schoolName} (${TEST_SCHOOL.schoolId})`);
    console.log('');

    let totalQuestions = 0;
    let totalCorrect = 0;
    let totalScore = 0;
    const roundResults = [];

    try {
        // Step 1: Login
        console.log('📝 Step 1: Logging in...');
        await login();
        console.log('   ✅ Login successful\n');

        // Step 2: Reset quiz to clean state
        console.log('🔄 Step 2: Resetting quiz...');
        await resetQuiz();
        console.log('   ✅ Quiz reset successful\n');

        // Verify reset
        const initialState = await getQuizState();
        console.log(`   Current round: ${initialState.data.currentRound}`);
        console.log(`   Round started: ${initialState.data.roundStarted}\n`);

        // Step 3: Play through all rounds
        for (const round of ROUNDS) {
            console.log('───────────────────────────────────────────────────────────────');
            console.log(`🎮 ${round.name.toUpperCase()} (Index: ${round.index})`);
            console.log('───────────────────────────────────────────────────────────────');

            // Start the round (Admin action)
            console.log(`   📌 Starting ${round.name}...`);
            try {
                const startResult = await startRound(round.index);
                console.log(`   ✅ ${round.name} started: ${startResult.message}`);
            } catch (error) {
                console.log(`   ❌ Failed to start ${round.name}: ${error.message}`);
                throw error;
            }

            // Small delay to let state propagate
            await delay(500);

            // Fetch questions for this round
            console.log(`   📚 Fetching questions for ${round.name}...`);
            const questionsResponse = await getQuestions(round.expectedQuestions, round.index);
            const questions = questionsResponse.data.questions;

            console.log(`   ✅ Received ${questions.length} questions (expected: ${round.expectedQuestions})`);

            if (questions.length !== round.expectedQuestions) {
                console.log(`   ⚠️ WARNING: Expected ${round.expectedQuestions} questions but got ${questions.length}`);
            }

            let roundScore = 0;
            let roundCorrect = 0;

            // Initialize quiz state for this round
            await updateQuizState(round.index, 0, 'init');

            // Play through each question
            for (let q = 0; q < questions.length; q++) {
                const question = questions[q];
                totalQuestions++;

                console.log(`\n   📋 Question ${q + 1}/${questions.length}:`);
                console.log(`      Type: ${question.questionType || 'Unknown'}`);
                console.log(`      Question: ${question.question.substring(0, 60)}...`);
                console.log(`      Options: ${question.options.map(o => o.label).join(', ')}`);

                // Update quiz state to current question
                await updateQuizState(round.index, q, question.id);

                // Find the best answer (highest correctness score)
                const bestOption = question.options.reduce((best, current) => {
                    const currentScore = current.correctness ?? current.score ?? 0;
                    const bestScore = best?.correctness ?? best?.score ?? 0;
                    return currentScore > bestScore ? current : best;
                }, question.options[0]);

                const selectedOptionId = bestOption.id || bestOption.label;
                console.log(`      Selecting: ${selectedOptionId} (score: ${bestOption.correctness ?? bestOption.score ?? 0})`);

                // Submit answer
                try {
                    const answerResult = await submitAnswer(selectedOptionId);
                    const points = answerResult.data.calculatedScore;
                    roundScore += points;
                    totalScore += points;

                    if (answerResult.data.isCorrect) {
                        roundCorrect++;
                        totalCorrect++;
                        console.log(`      ✅ Correct! +${points} points`);
                    } else {
                        console.log(`      ⚡ Partial score: +${points} points`);
                    }
                } catch (error) {
                    // Might get duplicate submission error if test is re-run
                    if (error.message.includes('already submitted')) {
                        console.log(`      ⚠️ Already answered this question`);
                    } else {
                        console.log(`      ❌ Error submitting: ${error.message}`);
                    }
                }

                // Small delay between questions
                await delay(200);
            }

            // Get quiz state to verify round completion
            const roundState = await getQuizState();
            console.log(`\n   📊 ${round.name} Summary:`);
            console.log(`      Questions answered: ${questions.length}`);
            console.log(`      Correct answers: ${roundCorrect}`);
            console.log(`      Round score: ${roundScore.toFixed(2)}`);
            console.log(`      Current question index: ${roundState.data.currentQuestionIndex}`);

            roundResults.push({
                round: round.name,
                questions: questions.length,
                correct: roundCorrect,
                score: roundScore,
            });

            // Delay before next round
            await delay(500);
        }

        // Final summary
        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log('                     TEST RESULTS');
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('');
        console.log('Round-by-Round Results:');
        console.log('─────────────────────────────────────────────────────────');

        for (const result of roundResults) {
            const correctPct = ((result.correct / result.questions) * 100).toFixed(0);
            console.log(`  ${result.round.padEnd(30)} | ${result.questions} Qs | ${result.correct}/${result.questions} correct (${correctPct}%) | ${result.score.toFixed(2)} pts`);
        }

        console.log('─────────────────────────────────────────────────────────');
        console.log('');
        console.log(`📊 Total Questions: ${totalQuestions}`);
        console.log(`✅ Total Correct: ${totalCorrect}`);
        console.log(`🏆 Total Score: ${totalScore.toFixed(2)}`);
        console.log('');

        // Validate expectations
        const expectedTotal = ROUNDS.reduce((sum, r) => sum + r.expectedQuestions, 0);
        if (totalQuestions === expectedTotal) {
            console.log(`✅ PASS: Completed all ${expectedTotal} questions as expected`);
        } else {
            console.log(`❌ FAIL: Expected ${expectedTotal} questions but completed ${totalQuestions}`);
        }

        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log('                   TEST COMPLETE');
        console.log('═══════════════════════════════════════════════════════════════\n');

        return {
            success: totalQuestions === expectedTotal,
            totalQuestions,
            totalCorrect,
            totalScore,
            roundResults,
        };

    } catch (error) {
        console.error('\n❌ TEST FAILED WITH ERROR:');
        console.error(error);
        throw error;
    }
}

// Run the test
runFullQuizTest()
    .then(result => {
        process.exit(result.success ? 0 : 1);
    })
    .catch(() => {
        process.exit(1);
    });
