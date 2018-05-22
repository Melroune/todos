const express = require('express')
const bodyParser = require('body-parser')
const multer = require('multer')
const fs = require('fs')
const util = require('util')
const path = require('path')
const session = require('express-session')
const FileStore = require('session-file-store')(session)

// load .env config file
require('dotenv').config({ path: path.join(__dirname, '.env') })

const db = require('./db')
const safe = require('./safe')
const imageUploader = require('./imageUploader.js')

const secret = process.env.SESSION_SECRET

const rename = util.promisify(fs.rename)

const port = process.env.PORT || 3247

const app = express()


const publicImagesPath = path.join(__dirname, 'public/images')

const storage = multer.diskStorage({
  destination: publicImagesPath,
  filename: (req, file, cb) => {
    cb(null, file.originalname)
  }
})
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 1000000, // 1 MB
  },
  fileFilter: (req, files, cb) => {
    if (!files.mimetype.startsWith('image/')) { // accept image only
      return cb(Error('Invalid file type'))
    }
    cb(null, true)
  }
})

// MIDDLEWARES

const authRequired = (req, res, next) => {
  if (!req.session.user) {
    return next(Error('Unauthorized'))
  }

  next()
}

app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: false }))

app.use(session({
  secret,
  saveUninitialized: true,
  resave: true,
  store: new FileStore({ secret }),
}))

app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`, { sessionUser: req.session.user && req.session.user.email })
  next()
})

app.use('/images', express.static(publicImagesPath))

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin)
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept')
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTION')
  res.header('Access-Control-Allow-Credentials', 'true')
  next()
})


// ROUTES

app.get('/', (req, res) => {
  res.send('ok')
})

// Authentication

const prepareUser = user => {
  if (!user) return {}

  return { user: { id: user.id, name: user.name, email: user.email } }
}

app.get('/whoami', (req, res) => {
  res.json(prepareUser(req.session.user))
})

app.post('/sign-up', upload.single(), async (req, res, next) => {
  const { name, email, password } = req.body

  const userAlreadyExists = await db.users.read.byEmail(email)

  if (userAlreadyExists) {
    return next(Error('User already exists'))
  }

  const credentials = { name, email, password: safe.encrypt(password) }

  db.users.create(credentials)
    .then(() => res.json('ok'))
    .catch(next)
})

app.post('/sign-in', upload.single(), async (req, res, next) => {
  const { email, password } = req.body

  const users = await db.users.read()

  const user = users.find(user => user.email === email)

  if (!user || password !== safe.decrypt(user.password)) {
    return next(Error('Invalid email or password'))
  }

  req.session.user = user

  res.json(prepareUser(req.session.user))
})

app.get('/sign-out', (req, res, next) => {
  req.session.user = undefined

  res.json(prepareUser(req.session.user))
})

// Todos

app.get('/todos', (req, res, next) => {
  db.todos.read()
    .then(todos => res.json(todos))
    .catch(next)
})

app.post('/todos', authRequired, upload.single('image'), async (req, res, next) => {
  const imageUrl = req.file
    ? (await imageUploader.upload(path.join(publicImagesPath, req.file.filename)).catch(next)).secure_url
    : process.env.DEFAULT_IMAGE_URL

  db.todos.create({
    userId: req.session.user.id,
    title: req.body.title,
    description: req.body.description,
    image: imageUrl
  })
  .then(() => db.todos.read().then(todos => res.json(todos)))
  .catch(next)
})

app.get('/todos/:id', async (req, res, next) => {
  db.todos.read.byId(req.params.id)
    .then(todo => res.json(todo))
    .catch(next)
})

app.get('/todos/vote/:id', authRequired, async (req, res, next) => {
  const todoId = req.params.id
  const userId = req.session.user.id

  const hasVoted = await db.stars.read.byUserIdAndTodoId(userId, todoId)

  return (hasVoted
    ? db.stars.delete({ todoId, userId })
    : db.stars.create({ todoId, userId })
  ).then(() => res.json('ok')).catch(next)
})

app.delete('/todos/:id', authRequired, async (req, res, next) => {
  const todoId = req.params.id
  const userId = req.session.user.id

  const todo = await db.todos.read.byId(todoId)


  if (!todo || userId != todo.userId) {
    return next(Error('Invalid request'))
  }

  db.todos.delete(todoId)
    .then(() => db.todos.read().then(todos => res.json(todos)))
    .catch(next)
})

// Errors handling

app.use((err, req, res, next) => {
  if (err) {
    res.json({ error: err.message })
    console.error(err)
  }

  next()
})

app.listen(port, () => console.log(`server listenning on port: ${port}`))
