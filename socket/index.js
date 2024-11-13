const express = require('express')
const { Server } = require('socket.io')
const http = require('http')
const getUserDetailsFromToken = require('../helpers/getUserDetailsFromToken')
const UserModel = require('../models/UserModel')
const { ConversationModel, MessageModel } = require('../models/ConversationModel')
const getConversation = require('../helpers/getConversation')

const app = express()

// **Socket connection setup**
const server = http.createServer(app)
const io = new Server(server, {
    cors: {
        origin: process.env.FRONTEND_URL,
        credentials: true
    }
})

const onlineUser = new Set()

io.on('connection', async (socket) => {
    console.log("User connected with socket ID:", socket.id)

    const token = socket.handshake.auth.token
    const user = await getUserDetailsFromToken(token)

    if (!user || !user._id) {
        console.error("Invalid user or user ID, disconnecting socket:", socket.id)
        socket.disconnect()
        return
    }

    // Create a room for the current user
    socket.join(user._id.toString())
    onlineUser.add(user._id.toString())

    io.emit('onlineUser', Array.from(onlineUser))

    // Handle 'message-page' event
    socket.on('message-page', async (userId) => {
        console.log('Message page requested for userId:', userId)

        const userDetails = await UserModel.findById(userId).select("-password")

        const payload = {
            _id: userDetails?._id,
            name: userDetails?.name,
            email: userDetails?.email,
            profile_pic: userDetails?.profile_pic,
            online: onlineUser.has(userId)
        }
        socket.emit('message-user', payload)

        // Get previous messages
        const getConversationMessage = await ConversationModel.findOne({
            "$or": [
                { sender: user._id, receiver: userId },
                { sender: userId, receiver: user._id }
            ]
        }).populate('messages').sort({ updatedAt: -1 })

        socket.emit('message', getConversationMessage?.messages || [])
    })

    // Handle 'new message' event
    socket.on('new message', async (data) => {
        let conversation = await ConversationModel.findOne({
            "$or": [
                { sender: data.sender, receiver: data.receiver },
                { sender: data.receiver, receiver: data.sender }
            ]
        })

        if (!conversation) {
            const createConversation = new ConversationModel({
                sender: data.sender,
                receiver: data.receiver
            })
            conversation = await createConversation.save()
        }

        const message = new MessageModel({
            text: data.text,
            imageUrl: data.imageUrl,
            videoUrl: data.videoUrl,
            msgByUserId: data.msgByUserId
        })
        const saveMessage = await message.save()

        await ConversationModel.updateOne(
            { _id: conversation._id },
            { "$push": { messages: saveMessage._id } }
        )

        const updatedConversation = await ConversationModel.findOne({
            "$or": [
                { sender: data.sender, receiver: data.receiver },
                { sender: data.receiver, receiver: data.sender }
            ]
        }).populate('messages').sort({ updatedAt: -1 })

        io.to(data.sender).emit('message', updatedConversation?.messages || [])
        io.to(data.receiver).emit('message', updatedConversation?.messages || [])

        // Send conversation updates
        const conversationSender = await getConversation(data.sender)
        const conversationReceiver = await getConversation(data.receiver)

        io.to(data.sender).emit('conversation', conversationSender)
        io.to(data.receiver).emit('conversation', conversationReceiver)
    })

    // Handle 'sidebar' event
    socket.on('sidebar', async (currentUserId) => {
        console.log("Sidebar request for currentUserId:", currentUserId)

        const conversation = await getConversation(currentUserId)
        socket.emit('conversation', conversation)
    })

    // Handle 'seen' event
    socket.on('seen', async (msgByUserId) => {
        const conversation = await ConversationModel.findOne({
            "$or": [
                { sender: user._id, receiver: msgByUserId },
                { sender: msgByUserId, receiver: user._id }
            ]
        })

        const conversationMessageId = conversation?.messages || []

        await MessageModel.updateMany(
            { _id: { "$in": conversationMessageId }, msgByUserId },
            { "$set": { seen: true } }
        )

        // Send conversation updates
        const conversationSender = await getConversation(user._id.toString())
        const conversationReceiver = await getConversation(msgByUserId)

        io.to(user._id.toString()).emit('conversation', conversationSender)
        io.to(msgByUserId).emit('conversation', conversationReceiver)
    })

    // Handle 'disconnect' event
    socket.on('disconnect', () => {
        if (user && user._id) {
            onlineUser.delete(user._id.toString())
        }
        console.log('User disconnected with socket ID:', socket.id)
    })
})

module.exports = {
    app,
    server
}
