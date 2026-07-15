import dotenv from 'dotenv'
import { ChatOpenAI } from '@langchain/openai'

dotenv.config()

const model = new ChatOpenAI({
  modelName: process.env.MODEL_NAME,
  apiKey: process.env.API_KEY,
  configuration: {
    baseURL: process.env.BASE_URL
  }
})

const response = await model.invoke('say hi!你是什么模型？')

console.log('==!==', response.content)
