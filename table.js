require('dotenv').config()
const packagejson = require('./package.json')
const nunjucks = require('nunjucks')
const session = require('express-session')
const express = require('express')
const path = require('path')
const jsonfile = require('jsonfile')
const log = require('ololog')
const redis = require('redis')
const io = require('socket.io')
const passport = require('passport')
const Strategy = require('passport-local').Strategy
const bodyParser = require('body-parser')
const flash = require('connect-flash')
const csrf = require('csurf')
const helmet = require('helmet')
const cookieParser = require('cookie-parser')

class Table {
    async setup() {
        log('Starting')

        this.tables = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]

        await this.loadAccounts()
        await this.loadAntiBruteForce()
        await this.startRedis()
        await this.createSessionStore()
        await this.startPassport()
        await this.startExpress()
        await this.startSocketIO()
    }

    async startPassport() {
        passport.use(
            new Strategy((username, password, cb) => {
                const user = this.accounts.filter(account => {
                    return account.username === username && account.password === password
                })
                if (user.length !== 1) {
                    return cb(null, false)
                }
                return cb(null, user[0])
            })
        )

        passport.serializeUser((user, cb) => {
            cb(null, user.username)
        })

        passport.deserializeUser((username, cb) => {
            const user = this.accounts.filter(account => {
                return account.username === username
            })
            cb(null, user[0])
        })
    }

    async loadAntiBruteForce() {
        const ExpressBrute = require('express-brute')
        const RedisStore = require('express-brute-redis')
        this.store = new RedisStore({
            host: process.env.REDIS_HOST,
            port: process.env.REDIS_PORT
        })
        this.bruteforce = new ExpressBrute(this.store)
    }

    async startSocketIO() {
        function onAuthorizeSuccess(data, accept) {
            accept()
        }

        function onAuthorizeFail(data, message, error, accept) {
            if (error) accept(new Error(message))
            log('failed connection to socket.io:', message)
            accept(null, false)
        }

        var passportSocketIo = require('passport.socketio')
        this.io = require('socket.io')(this.httpServer)
        this.io.use(
            passportSocketIo.authorize({
                cookieParser: cookieParser,
                secret: process.env.SESSION_SECRET,
                store: this.sessionStore,
                success: onAuthorizeSuccess,
                fail: onAuthorizeFail
            })
        )

        this.io.sockets.on('connection', socket => {
            socket.on('tableUpdate', payload => {
                this.tables[payload.table] = payload.value
                let state = 'Empty'
                if (payload.value === 1) state = 'Booked'
                if (payload.value === 2) state = 'In-use'
                this.redis.set(`table_${payload.table}`, payload.value)
                this.io.sockets.emit(
                    'infomessage',
                    `${socket.request.user.username} set Table ${payload.table} to ${state}`
                )
                this.io.sockets.emit('table', this.tables)
            })

            socket.on('requestTable', () => {
                socket.emit('table', this.tables)
            })
        })
    }

    async startRedis() {
        this.redis = redis.createClient()

        this.redis.on('error', function (error) {
            throw new Error(error)
        })

        for (let index in this.tables) {
            this.redis.get(`table_${index}`, (err, val) => {
                if (val) {
                    this.tables[index] = val
                }
            })
        }
    }

    createSessionStore() {
        var RedisStore = require('connect-redis')(session)
        this.sessionStore = new RedisStore({
            client: this.redis,
            host: 'localhost',
            port: 6379
        })
    }

    async loadAccounts() {
        this.accounts = (await jsonfile.readFile(path.join(__dirname, process.env.ACCOUNTSFILE))).accounts
    }

    async startExpress() {
        // Express init & template config
        this.expressApp = express()
        nunjucks.configure(path.join(__dirname, 'templates'), {
            autoescape: true,
            express: this.expressApp
        })
        this.expressApp.set('view engine', 'html')

        // express app middleware
        // this.expressApp.use(helmet())
        this.expressApp.use(flash())
        this.expressApp.use(passport.initialize())
        this.expressApp.use(passport.session())
        this.expressApp.use(require('morgan')('short'))
        this.expressApp.use(express.static('static'))
        this.expressApp.use(cookieParser())
        const csrfProtection = csrf({ cookie: true })
        this.expressApp.use(bodyParser.json())
        this.expressApp.use(
            bodyParser.urlencoded({
                extended: true
            })
        )

        this.expressApp.use(
            session({
                genid: req => {
                    return require('crypto').randomBytes(32).toString('hex')
                },
                store: this.sessionStore,
                secret: process.env.SESSION_SECRET,
                resave: false,
                saveUninitialized: false
            })
        )

        // custom express middlewares
        const needsLogin = (req, res, next) => {
            if (req.session) {
                if (req.session.passport) {
                    if (req.session.passport.user) {
                        return next()
                    }
                }
            }
            req.flash('error', 'You need to be logged in the access that page')
            return res.redirect('/login')
        }

        this.expressApp.use((req, res, next) => {
            if (req.session.passport) res.locals['passport'] = req.session.passport

            res.locals['error'] = req.flash('error')
            res.locals['success'] = req.flash('success')
            return next()
        })

        // routes
        this.expressApp.get('/', needsLogin, (req, res) => {
            res.render('list', { tables: this.tables })
        })

        this.expressApp.get('/login', csrfProtection, (req, res) => {
            res.render('login', {
                csrfToken: req.csrfToken()
            })
        })

        this.expressApp.get('/logout', (req, res) => {
            req.session.destroy()
            return res.redirect('/login')
        })

        if (process.env.NODE_ENV === 'development') {
            log('Warning!! running in development mode, security is weakened')
            this.bruteforce.prevent = (req, res, next) => {
                next()
            }
        }

        this.expressApp.post(
            '/login',
            csrfProtection,
            this.bruteforce.prevent,
            passport.authenticate('local', {
                failureFlash: 'Invalid username or password.',
                failureRedirect: '/login'
            }),
            (req, res) => {
                req.flash('success', 'yeet')
                res.redirect('/')
            }
        )

        // web server listen
        this.httpServer = require('http')
            .createServer(this.expressApp)
            .listen(process.env.WEB_PORT, () => {
                log(`${packagejson.name} web service listening at 0.0.0.0:${process.env.WEB_PORT}`)
            })
    }
}

new Table().setup()
