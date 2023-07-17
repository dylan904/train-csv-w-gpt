const fs = require('fs'); 
const parse = require('csv-parse').parse;
const prompt = require('prompt-sync')();
const { Select, MultiSelect } = require('enquirer');
const chalk = require('chalk');
const RateLimit = require('async-sema').RateLimit;
const parseSync = require('csv-parse/sync').parse;
const { Parser } = require('@json2csv/plainjs');
require('dotenv').config();

const maxTokensPerReq = 500;
const chatHistoryLimit = 50;

const tokenQuotaPM = 120000;
const limit = RateLimit(Math.floor(tokenQuotaPM / 60 / maxTokensPerReq));

let evaluateEach = true;
let overTokenLimit = false;

const rawChoices = ['None', 'Authentication', 'Data', 'Navigation', 'Notification', 'Performance', 'Search', 'UI'];
const choices = rawChoices.map((choice, idx) => ({name: `${idx} - ${choice}`, value: choice}))

const chatData = [
    {"role":"system","content":"You are a chatbot designed to receive feedback for a digital product, provided by hiring managers and categorize from the following list: \"UI, Navigation, Data, Performance, Notification, Authentication, Search\". If none of the categories are matched, just respond with \"None\". Do not provide any answers other than the ones I have provided."},
    {"role":"user","content":"the active assignments are always loading and the assignment doesn't actually show up."},
    {"role":"assistant","content":"Performance, UI"},
    {"role":"user","content":"could not find the snapshot"},
    {"role":"assistant","content":"Search"},
    {"role":"user","content":"testing"},
    {"role":"assistant","content":"None"}
];

const fetchData = {
    "messages": null,
    "max_tokens": 48,
    "temperature": 0,
    "frequency_penalty": 0,
    "presence_penalty": 0,
    "top_p": 0.25,
    "stop": null
};

let inputKey, outputKey;

(async () => {
    const inputFile = await pickCSV();
    console.log(chalk.blueBright('Processing your file...'));

    const data = [];
    fs.createReadStream(inputFile)
    .pipe(parse({delimiter: ',', columns: true}))
    .on('data', (item) => {
        data.push(item);
    })
    .on('end', () => {
        shuffleArray(data);
        processData(inputFile, data);
    });
})();

process.on('SIGINT', () => {
    evaluateEach = false;
    console.log('Indivdual evaluation stopped. If you would like to exit, press Control-D.');
});

async function processHeaders(inputFile, headers, data) {
    const headersCopy = JSON.parse(JSON.stringify(headers));
    inputKey = await pickHeader(headersCopy, 'Pick the column you want to evaluate.');

    const outputHeaderOpts = [...headers.filter(item => item !== inputKey), '---Create New---'];
    const outputHeaderOptsCopy = JSON.parse(JSON.stringify(outputHeaderOpts));
    outputKey = await pickHeader(outputHeaderOptsCopy, 'Pick the column where you want to output your results.');

    if (outputHeaderOpts.indexOf(outputKey) === outputHeaderOpts.length-1) {
        console.log('CREATE A NEW COLUMN');
        outputKey = prompt(chalk.yellow('What is the name for your new output column? '));
        headers.push(outputKey);
        
        writeData(inputFile, headers, data);
    }

    return { inputKey, outputKey };
}

async function processData(inputFile, data) {
    //console.log('processing', data);

    const totalItems = data.length;
    const headers = Object.keys(data[0]);   // from data sample

    const { inputKey, outputKey } = await processHeaders(inputFile, headers, data);

    let preprocessedCt = 0;

    for (let item of data) {
        if ((chatData.length+1) / 2 > chatHistoryLimit)
            break;

        if (item[outputKey]) {
            ++preprocessedCt;
            chatData.push({role: "user", content: item[inputKey]});
            chatData.push({role: "assistant", content: item[outputKey]});
        }
    }

    //console.log('initial context', chatData)

    for (const [idx, item] of data.entries()) {
        if (item[outputKey])
            continue;

        await limit();
        console.clear();

        const inputString = item[inputKey];
        
        const overHistoryLimit = chatData.length/2 > chatHistoryLimit;
        const evaluateItem = evaluateEach && !overHistoryLimit && !overTokenLimit;

        if (evaluateItem) {
            chatData.push({"role": "user", "content": inputString})
            fetchData.messages = chatData;
        }
        else {
            const chatDataCopy = JSON.parse(JSON.stringify(chatData));
            chatDataCopy.push({"role": "user", "content": inputString});
            fetchData.messages = chatDataCopy
        }

        console.log('context', fetchData.messages)

        const logString = (idx + preprocessedCt + 1) + '/' + totalItems + '   ' + inputKey + ': ' + chalk.yellow(inputString);
        const chatResponse = await fetchGPT(logString);
        const tokenUsage = chatResponse.usage.total_tokens;

        if (tokenUsage > maxTokensPerReq) {
            chatData.splice(chatData.length-2, 2); // remove last query to go below token limit
            overTokenLimit = true;
        }

        console.log('TOKENS USED: ', tokenUsage);
        
        const firstChoice = chatResponse.choices[0];
        let chatAnswer = firstChoice.message.content;
        let chatAnswerArr = chatAnswer.split(",").map((i) => i.trim());

        if (chatAnswerArr.some((x) => !rawChoices.includes(x))) {
            console.warn('UNEXPECTED GPT RESONSE: ' + chatAnswer);
            chatAnswerArr = chatAnswerArr.filter(item => rawChoices.includes(item));
            chatAnswer = chatAnswerArr.join(', ');
        }

        if (evaluateItem) {
            // console.log(chatAnswerArr)
            // console.log(chatAnswerArr.map(text => rawChoices.indexOf(text) + ' - ' + text))
        
            const myPrompt = new MultiSelect({
                name: 'value',
                message: 'Select all that apply',
                choices: choices,
                initial: chatAnswerArr.map(text => rawChoices.indexOf(text) + ' - ' + text),
                result(names) {
                    return this.map(names);
                }
            });
            const myAnswer = await myPrompt.run();

            const myFormattedAnswer = Object.values(myAnswer);

            //chatData.push({"role": "assistant", "content": myAnswer.join(', ')})
            console.log('ANSWERIT', myFormattedAnswer)

            item[outputKey] = myFormattedAnswer.join(', ');
        }
        else {
            item[outputKey] = chatAnswer;
        }

        writeData(inputFile, headers, data);
    }
}

function findFiles(filter) {
    var files = fs.readdirSync('./');
    const foundFiles = [];
    for (var i = 0; i < files.length; i++) {
        if (files[i].endsWith(filter)) {
            foundFiles.push(files[i])
        };
    }
    return foundFiles;
}

async function pickCSV() {
    const csvFileChoices = findFiles('.csv');

    if (!csvFileChoices.length) {
        console.log(chalk.redBright('NO CSV FILE FOUND. Move a .csv file to this folder then proceed.'));
        process.exit();
    }

    console.log(csvFileChoices);

    const myPrompt = new Select({
        name: 'inputfile',
        message: 'Select your CSV file',
        choices: csvFileChoices
    });
    return await myPrompt.run();
}

async function pickHeader(opts, prompt) {
    const myPrompt = new Select({
        name: 'header',
        message: prompt,
        choices: opts
    });
    return await myPrompt.run();
}

function writeData(inputFile, headers, data) {
    const json2csvParser = new Parser({fields: headers});
    const csv = json2csvParser.parse(data);
    console.log('csv', csv);
    fs.writeFileSync(inputFile, csv);
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

async function fetchGPT(logString) {
    const response = await fetch('https://bln-nlp-openai-test.openai.azure.com/openai/deployments/dylan-test-deploy/chat/completions?api-version=2023-03-15-preview', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'api-key': process.env.AZURE_OAI_KEY,
            'Connection': 'keep-alive'
        },
        body: JSON.stringify(fetchData)
    });
    const chatResponse = await response.json();

    console.log(logString)

    if (response.status == 429) {
        console.log(chalk.redBright('RATE LIMITED: WAITING...'))
        await new Promise(resolve => setTimeout(resolve, 15000));
        return await fetchGPT(logString);
    }
    else if (response.status !== 200) {
        console.log(chalk.redBright('RESPONSE ERROR: ' + response.status));
        process.exit();
    }
    else if (chatResponse.error) {
        console.error('chat error', chatResponse.error);
        process.exit();
    }
    return chatResponse;
}