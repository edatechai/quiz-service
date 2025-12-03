import axios from "axios";
import { env } from "../config/env.js";

const DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions";

/**
 * Get the DeepSeek API key from environment
 */
function getDeepSeekApiKey() {
	const key = env.deepseekApiKey || process.env.DEEPSEEK_API_KEY || "";
	return key.trim();
}

/**
 * Format the AI Team prompt based on the provided Python template
 */
function formatAITeamPrompt(question, options, image = null, audio = null) {
	const optionsText = options
		.map((opt, idx) => {
			const label = opt.label || opt.id || String.fromCharCode(65 + idx);
			return `${label}) ${opt.text}`;
		})
		.join("\n");

	let prompt = `You are an AI system participating in a quiz competition. You will provide answers along with detailed rationales. Your responses will be analyzed to understand AI capabilities and limitations.

**Important Context:**

- You are operating with potential limitations (outdated training data, reasoning constraints, etc.)

- Your responses should be genuine attempts to answer correctly

- However, you may occasionally make mistakes that are characteristic of AI systems:

  * Hallucinations (confidently stating incorrect information)

  * Outdated knowledge (information that was correct in your training but may have changed)

  * Reasoning errors (logical mistakes in your analysis)

  * Overconfidence in uncertain situations

  * Misinterpretation of questions or context

- These mistakes should occur naturally and occasionally, not in every response

- When you make a mistake, your rationale should still appear logical to you, demonstrating how AI can be confidently wrong

**Parameters Provided:**

- Question: ${question}

- Options:
${optionsText}`;

	if (image) {
		prompt += `\n- Image (if available): ${image}`;
	}

	if (audio) {
		prompt += `\n- Audio (if available): ${audio}`;
	}

	prompt += `

**Your Task:**

1. Analyze the question, options, and any provided image or audio

2. Determine what you believe is the correct answer

3. Provide a brief rationale explaining your reasoning

4. Despite any internal reasoning, your visible output must not exceed 3 sentences total

**Response Format (max 3 sentences):**

- Sentence 1: State the selected answer (include the option letter/text) and confidence (high/medium/low).

- Sentence 2-3: Provide a concise rationale and (optionally) mention one alternative you considered.

**Important Notes:**

- Answer honestly based on your knowledge and reasoning

- If your knowledge is outdated or incomplete, proceed with what you know (this may naturally lead to mistakes)

- If you're uncertain, still provide an answer but indicate lower confidence

- Your rationale should be concise yet well-reasoned, even if the answer is incorrect

- If an image is provided, describe what you observe, but acknowledge any limitations in image analysis

- If audio is provided, describe what you hear (music characteristics, sounds, speech, location cues, etc.), but acknowledge any limitations in audio analysis

- Do not intentionally make mistakes - let them occur naturally through your limitations

**Example of Natural Mistakes You Might Make:**

- Confusing similar concepts or facts

- Applying outdated information

- Overgeneralizing from limited knowledge

- Missing subtle nuances in the question

- Making logical leaps that seem reasonable but are incorrect

- Being overconfident when you should be uncertain

Remember: Provide your genuine best attempt at answering, with full transparency in your rationale, in no more than 3 sentences.

Let's think step by step.`;

	return prompt;
}

/**
 * Get DeepSeek API payload for AI Team
 */
function getAITeamApiPayload(question, options, image = null, audio = null) {
	const prompt = formatAITeamPrompt(question, options, image, audio);

	return {
		model: "deepseek-chat",
		messages: [
			{
				role: "user",
				content: prompt,
			},
		],
		temperature: 0.6, // For reasoning tasks
		max_tokens: 2000, // For detailed rationale
	};
}

/**
 * Parse AI response to extract the selected answer option
 * Looks for patterns like "A)", "B)", "Option A", etc.
 */
function parseAIResponse(responseText, options) {
	if (!responseText || typeof responseText !== "string") {
		return null;
	}

	const text = responseText.trim().toUpperCase();

	// Try to find option labels (A, B, C, D, etc.)
	const labels = options.map((opt) => {
		const label = (opt.label || opt.id || "").toUpperCase().replace(/[^A-Z]/g, "");
		return label;
	});

	// Look for option patterns in the response
	for (let i = 0; i < labels.length; i++) {
		const label = labels[i];
		// Match patterns like "A)", "A.", "Option A", "answer is A", etc.
		const patterns = [
			new RegExp(`\\b${label}\\)`, "i"),
			new RegExp(`\\b${label}\\.`, "i"),
			new RegExp(`option\\s+${label}`, "i"),
			new RegExp(`answer\\s+(is\\s+)?${label}`, "i"),
			new RegExp(`selected\\s+${label}`, "i"),
			new RegExp(`choose\\s+${label}`, "i"),
		];

		for (const pattern of patterns) {
			if (pattern.test(text)) {
				return options[i];
			}
		}
	}

	// If no pattern match, try to find the first option mentioned
	for (let i = 0; i < labels.length; i++) {
		if (text.includes(labels[i])) {
			return options[i];
		}
	}

	// Fallback: return first option if nothing matches
	return options[0] || null;
}

/**
 * Call DeepSeek API to get AI team's answer
 */
export async function getAITeamAnswer(question, options, image = null, audio = null) {
	const apiKey = getDeepSeekApiKey();
	
	if (!apiKey) {
		return {
			success: false,
			error: "DEEPSEEK_API_KEY is not configured",
			selectedOption: null,
			rawResponse: null,
			optionIndex: -1,
		};
	}

	try {
		const payload = getAITeamApiPayload(question, options, image, audio);

		const response = await axios.post(DEEPSEEK_API_URL, payload, {
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			timeout: 30000, // 30 seconds timeout
		});

		const aiResponse = response.data?.choices?.[0]?.message?.content || "";
		const selectedOption = parseAIResponse(aiResponse, options);

		return {
			success: true,
			selectedOption,
			rawResponse: aiResponse,
			optionIndex: selectedOption
				? options.findIndex((opt) => opt.id === selectedOption.id || opt.label === selectedOption.label)
				: -1,
		};
	} catch (error) {
		console.error("Error calling DeepSeek API:", error.message);
		return {
			success: false,
			error: error.message,
			selectedOption: null,
			rawResponse: null,
			optionIndex: -1,
		};
	}
}

/**
 * Calculate score based on selected option's correctness
 * The correctness value is already the actual points to award (not a 0-1 scale)
 */
export function calculateScore(selectedOption) {
	if (!selectedOption || selectedOption.correctness === undefined) {
		return 0;
	}

	// correctness is already the actual points value
	const rawPoints = Number(selectedOption.correctness ?? 0);
	return Number.isNaN(rawPoints) ? 0 : rawPoints;
}

