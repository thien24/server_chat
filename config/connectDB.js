const mongoose = require('mongoose')

async function connectDB(){
    try {
        await mongoose.connect(process.env.MONGODB_URL)
        const connection = mongoose.connection
        connection.on('connected', ()=>{
            console.log("MongoDB connected")
        })
        connection.on('error',(error)=>{
            console.log("MongoDB error", error)
            })

    } catch (error) {
        console.log("Something is erros", error)
    }
}

module.exports = connectDB