const fs = require('fs'); 
const parse = require('csv-parse').parse;
//const prompt = require('prompt-sync')();
const { MultiSelect } = require('enquirer');
const chalk = require('chalk');
const RateLimit = require('async-sema').RateLimit;

const limit = RateLimit(8);

const inputFile = 'input.csv';
const outputFile = 'output.json';
let idx = 0;
let evaluateEach = true;
const inputType = 'Feedback';
const chatHistoryLimit = 100;
const rawChoices = ['None', 'Authentication', 'Data', 'Navigation', 'Notification', 'Performance', 'Search', 'UI'];
const choices = rawChoices.map((choice, idx) => ({name: `${idx} - ${choice}`, value: choice}))

let totalItems = '?';

countLines(inputFile, (x, count) => (totalItems = count));

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

const stream = fs.createReadStream(inputFile)
.pipe(parse({delimiter: ',', from_line: 2}))
.on('data', async (item) => {
    try {
        stream.pause();
        await limit();

        console.clear();

        const inputFile = `output/${idx}.txt`;
    const feedback = item[0];

    // myRateLimiter(idx, feedback)
    //console.log(`${inputFile}: ${feedback}`);
    fs.writeFileSync(inputFile, feedback);

    const overHistoryLimit = chatData.length > chatHistoryLimit;
    const evaluateItem = evaluateEach && !overHistoryLimit;

    if (evaluateItem) {
        chatData.push({"role": "user", "content": feedback})
        fetchData.messages = chatData;
    }
    else {
        const chatDataCopy = JSON.parse(JSON.stringify(chatData));
        chatDataCopy.push({"role": "user", "content": feedback});
        fetchData.messages = chatDataCopy
    }

    console.log('context', fetchData.messages)
    
    
    // const response = await fetch("https://bln-nlp-openai-test.openai.azure.com/openai/deployments/dylan-test-deploy/chat/completions?api-version=2023-03-15-preview", {
    //     method: "POST",
    //     headers: {
    //         "Content-Type": "application/json",
    //         "api-key": "efcddbc77b5c49d28a1970000caab6e0",
    //         "Connection": "keep-alive"
    //     },
    //     body: JSON.stringify(fetchData),
    // });

    const response = await fetch('https://bln-nlp-openai-test.openai.azure.com/openai/deployments/dylan-test-deploy/chat/completions?api-version=2023-03-15-preview', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'api-key': 'efcddbc77b5c49d28a1970000caab6e0'
        },
        // body: '{\n  "messages": [{"role":"system","content":"You are a chatbot designed to receive feedback for a digital product, provided by hiring managers and categorize from the following list: \\"UI, Navigation, Data, Performance, Notification, Search\\". If none of the categories are matched, just respond with \\"None\\"."},{"role":"user","content":"the active assignments are always loading and the assignment doesn\\t actually show up."},{"role":"assistant","content":"Performance, UI"},{"role":"user","content":"could not find the snapshot"},{"role":"assistant","content":"Search, UX"},{"role":"user","content":"testing"}],\n  "max_tokens": 48,\n  "temperature": 0,\n  "frequency_penalty": 0,\n  "presence_penalty": 0,\n  "top_p": 0.25,\n  "stop": null\n}',
        body: JSON.stringify(fetchData)
    });
    const chatResponse = await response.json();

    console.log((idx+1) + '/' + totalItems + '   ' + inputType + ': ' + chalk.yellow(feedback))

    if (chatResponse.error) {
        console.error('chat error');
        process.exit();
    }
    
    const firstChoice = chatResponse.choices[0];
    const chatAnswer = firstChoice.message.content;
    const chatAnswerArr = chatAnswer.split(",").map((i) => {
        return i.trim();
    });

    if (chatAnswerArr.some((x) => !rawChoices.includes(x))) {
        console.warn('UNEXPECTED GPT RESONSE: ' + chatAnswer);
    }

    if (evaluateItem) {
        
       // console.log(chatAnswerArr)
       // console.log(chatAnswerArr.map(text => rawChoices.indexOf(text) + ' - ' + text))
console.log('answerip')
        const myPrompt = new MultiSelect({
            name: 'value',
            message: 'Select all that apply',
            choices: choices,
            initial: chatAnswerArr.map(text => rawChoices.indexOf(text) + ' - ' + text)
        });
        const myAnswer = await myPrompt.run();

        //chatData.push({"role": "assistant", "content": myAnswer.join(', ')})
        console.log('ANSWERIT', myAnswer)
    }

    ++idx;
    } finally {
        stream.resume();
    }
})
.on('end', () => {
    //console.log('CSV file successfully processed');
    //totalItems = idx+1;
});

process.on('SIGINT', () => {
    evaluateEach = false;
    console.log('Indivdual evaluation stopped. If you would like to exit, press Control-D.');
});


function countLines(filePath, callback) {
    let count = 0;
    fs.createReadStream(filePath)
    .pipe(parse({delimiter: ',', from_line: 2}))
    .on('error', e => callback(e))
    .on('data', () => {
        count++;
    })
    .on('end', () => callback(null, count-1));
};

function writeToFile(filename, item) {
    if (!fs.existsSync(outputFile)) {
        fs.writeFile('myjsonfile.json', {
            "projectFileVersion": "2022-05-01",
            "stringIndexType": "Utf16CodeUnit",
            "metadata": {
              "projectKind": "CustomMultiLabelClassification",
              "storageInputContainerName": "{CONTAINER-NAME}",
              "projectName": "{PROJECT-NAME}",
              "multilingual": false,
              "description": "Project-description",
              "language": "en-us"
            },
            "assets": {
              "projectKind": "CustomMultiLabelClassification",
              "classes": [
                {
                  "category": "Class1"
                },
                {
                  "category": "Class2"
                }
              ],
              "documents": []
          }
        }, 'utf8', () => appendToFile(filename, item));
    }
    else {
        appendToFile(filename, item);
    }
}

function appendToFile(filename, classes) {
    const categoryData = {
        "location": filename,
        //"language": "{LANGUAGE-CODE}",
        //"dataset": "{DATASET}",
        "classes": classes.map(item => ({ category: item }))
    };
    

    fs.readFile(outputFile, 'utf8', function readFileCallback(err, rawData){
        if (err) {
            console.log(err);
        } else {
            const data = JSON.parse(rawData);

            const foundIdx = data.assets.documents.findIndex(element => element > 1000);

            if (foundIdx === -1) {

            }

            data.table.push({id: 2, square:3});
            fs.writeFile(outputFile, JSON.stringify(obj), 'utf8');
        }
    });
}