
import mongoose from 'mongoose';

const MONGO_URL = 'mongodb://localhost:27017/edat-quiz';

async function run() {
    try {
        await mongoose.connect(MONGO_URL);
        const collection = mongoose.connection.db.collection('gameleaderboards');
        const teams = await collection.find({}).toArray();

        console.log('Total teams:', teams.length);

        let withAnswers = 0;
        let withRound3Answers = 0;

        teams.forEach(t => {
            if (t.answers && Object.keys(t.answers).length > 0) {
                withAnswers++;
                if (Object.keys(t.answers).some(k => k.startsWith('round3_'))) {
                    withRound3Answers++;
                }
            }
        });

        console.log('With ANY answers:', withAnswers);
        console.log('With Round 3 answers:', withRound3Answers);

        if (withAnswers > 0) {
            const first = teams.find(t => t.answers && Object.keys(t.answers).length > 0);
            console.log('Example team with answers:', first.schoolName);
            console.log('Answers preview:', JSON.stringify(Object.keys(first.answers).slice(0, 5)));
        }

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

run();
