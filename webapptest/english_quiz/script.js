let questions = [];
let currentQuestions = [];
let currentQuestionIndex = 0;
let score = 0;
let isAnswering = false;

// DOM Elements
const startScreen = document.getElementById('start-screen');
const quizScreen = document.getElementById('quiz-screen');
const resultScreen = document.getElementById('result-screen');
const idiomText = document.getElementById('idiom-text');
const optionsContainer = document.getElementById('options-container');
const feedbackSection = document.getElementById('feedback-section');
const feedbackTitle = document.getElementById('feedback-title');
const feedbackExplanation = document.getElementById('feedback-explanation');
const nextBtn = document.getElementById('next-btn');

// Status Elements
const currentQuestionNumEl = document.getElementById('current-question-num');
const totalQuestionsEl = document.getElementById('total-questions');
const currentScoreEl = document.getElementById('current-score');
const finalScoreEl = document.getElementById('final-score');
const finalTotalEl = document.getElementById('final-total');
const resultMessageEl = document.getElementById('result-message');

// Fetch and init
async function init() {
    try {
        const response = await fetch('questions.json');
        questions = await response.json();
    } catch (error) {
        console.error("Failed to load questions:", error);
        // Fallback or error handling
    }
}

// Randomly select N questions
function selectRandomQuestions(allQuestions, count) {
    const shuffled = [...allQuestions].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, Math.min(count, allQuestions.length));
}

function showStartScreen() {
    startScreen.classList.remove('hidden');
    quizScreen.classList.add('hidden');
    resultScreen.classList.add('hidden');
}

function startQuiz(level) {
    if (questions.length === 0) {
        init().then(() => {
            if (questions.length > 0) startQuiz(level);
        });
        return;
    }

    // Filter by level if specified
    let levelQuestions = questions;
    if (level) {
        levelQuestions = questions.filter(q => q.difficulty === level);
        // Fallback: If not enough questions in this level, use all
        if (levelQuestions.length < 5) {
            console.warn(`Not enough questions for level ${level}. Using all questions.`);
            levelQuestions = questions;
        }
    }

    currentQuestions = selectRandomQuestions(levelQuestions, 10);
    currentQuestionIndex = 0;
    score = 0;

    // UI Reset
    startScreen.classList.add('hidden');
    resultScreen.classList.add('hidden');
    quizScreen.classList.remove('hidden');

    totalQuestionsEl.textContent = currentQuestions.length;
    updateScore();
    loadQuestion();
}

function loadQuestion() {
    isAnswering = true;
    const question = currentQuestions[currentQuestionIndex];

    // Update Number
    currentQuestionNumEl.textContent = currentQuestionIndex + 1;

    // Set text
    idiomText.textContent = question.idiom;

    // Clear previous options
    optionsContainer.innerHTML = '';
    feedbackSection.classList.add('hidden');

    // Prepare options with correctness info
    const optionData = question.options.map((option, index) => ({
        text: option,
        isCorrect: index === question.correct
    }));

    // Shuffle options
    const shuffledOptions = optionData.sort(() => 0.5 - Math.random());

    // Create options
    shuffledOptions.forEach((opt) => {
        const btn = document.createElement('div');
        btn.classList.add('option-btn');
        btn.textContent = opt.text;
        // Store correctness on the element for easy access
        btn.dataset.isCorrect = opt.isCorrect;

        btn.onclick = () => checkAnswer(btn);
        optionsContainer.appendChild(btn);
    });
}

function checkAnswer(selectedBtn) {
    if (!isAnswering) return;
    isAnswering = false; // Prevent multiple clicks

    const question = currentQuestions[currentQuestionIndex];
    const isCorrect = selectedBtn.dataset.isCorrect === 'true';
    const optionBtns = optionsContainer.children;

    // Show correct/incorrect styles
    if (isCorrect) {
        selectedBtn.classList.add('correct');
        score++;
        updateScore();
        showFeedback(true, question.explanation);
    } else {
        selectedBtn.classList.add('incorrect');
        // Highlight correct answer
        Array.from(optionBtns).forEach(btn => {
            if (btn.dataset.isCorrect === 'true') {
                btn.classList.add('correct');
            }
        });
        showFeedback(false, question.explanation);
    }

    // Disable all buttons
    Array.from(optionBtns).forEach(btn => {
        btn.style.pointerEvents = 'none';
        if (btn !== selectedBtn && btn.dataset.isCorrect !== 'true') {
            btn.style.opacity = '0.5';
        }
    });
}

function showFeedback(isCorrect, explanation) {
    feedbackSection.classList.remove('hidden');

    if (isCorrect) {
        feedbackTitle.textContent = "Correct! 正解！";
        feedbackTitle.className = "feedback-title correct";
    } else {
        feedbackTitle.textContent = "Incorrect... 残念";
        feedbackTitle.className = "feedback-title incorrect";
    }

    feedbackExplanation.textContent = explanation;

    // Update Next Button text if last question
    if (currentQuestionIndex === currentQuestions.length - 1) {
        nextBtn.textContent = "結果を見る";
    } else {
        nextBtn.textContent = "次へ進む";
    }
}

function nextQuestion() {
    currentQuestionIndex++;

    if (currentQuestionIndex < currentQuestions.length) {
        loadQuestion();
    } else {
        showResult();
    }
}

function updateScore() {
    currentScoreEl.textContent = score;
}

function showResult() {
    quizScreen.classList.add('hidden');
    resultScreen.classList.remove('hidden');

    finalScoreEl.textContent = score;
    finalTotalEl.textContent = currentQuestions.length;

    // Custom message based on score
    const percentage = (score / currentQuestions.length) * 100;
    if (percentage === 100) {
        resultMessageEl.textContent = "Excellent! Idiom Masterの称号はあなたのものです！";
    } else if (percentage >= 80) {
        resultMessageEl.textContent = "Great job! かなりの英語力ですね！";
    } else if (percentage >= 60) {
        resultMessageEl.textContent = "Good! もう一息でマスターです！";
    } else {
        resultMessageEl.textContent = "Don't give up! 繰り返し練習して覚えましょう！";
    }
}

// Start loading data immediately
init();
