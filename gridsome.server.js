const pMap = require('p-map')
const axios = require('axios')
const fs = require('fs')
const path = require('path')
const camelCase = require('camelcase')
const { mapKeys, isPlainObject, trimEnd, map, find } = require('lodash')

const TYPE_AUTHOR = 'author'
const TYPE_ATTACHEMENT = 'attachment'

class WordPressSource {
  static defaultOptions () {
    return {
      baseUrl: 'https://ragamikan.com/',
      apiBase: 'wp-json',
      perPage: 100,
      concurrent: 10,
      routes: {
        post: '/:slug',
        category: '/category/:slug',
      },
      typeName: 'WordPress',
      splitPostsIntoFragments: true, // Split html posts into fragments representing html blocks or images
      downloadRemoteImagesFromPosts: true, // Download remote images from the post body
      postImagesLocalPath: 'src/assets/img/',
      downloadRemoteFeaturedImages: true, // Download featured images
      featuredImagesLocalPath: 'src/assets/img/', // Path to store featured images
    }
  }

  constructor (api, options) {
    this.options = options
    this.restBases = { posts: {}, taxonomies: {}}

    if (!options.typeName) {
      throw new Error(`Missing typeName option.`)
    }

    if (options.perPage > 100 || options.perPage < 1) {
      throw new Error(`${options.typeName}: perPage cannot be more than 100 or less than 1.`)
    }

    const baseUrl = trimEnd(options.baseUrl, '/')

    this.client = axios.create({
      baseURL: `${baseUrl}/${options.apiBase}`
    })

    this.routes = {
      post: '/:year/:month/:day/:slug',
      post_tag: '/tag/:slug',
      category: '/category/:slug',
      author: '/author/:slug',
      ...this.options.routes
    }

    api.loadSource(async store => {
      this.store = store

      console.log(`Loading data from ${baseUrl}`)

      await this.getPostTypes(store)
      await this.getUsers(store)
      await this.getTaxonomies(store)
      await this.getPosts(store)
    })
  }

  async getPostTypes (store) {
    const { data } = await this.fetch('wp/v2/types', {}, {})

    for (const type in data) {
      const options = data[type]

      this.restBases.posts[type] = options.rest_base

      store.addContentType({
        typeName: this.createTypeName(type),
        route: this.routes[type] || `/${options.rest_base}/:slug`
      })
    }
  }

  async getUsers (store) {
    const { data } = await this.fetch('wp/v2/users')

    const authors = store.addContentType({
      typeName: this.createTypeName(TYPE_AUTHOR),
      route: this.routes.author
    })

    for (const author of data) {
      const fields = this.normalizeFields(author)
      const avatars = mapKeys(author.avatar_urls, (v, key) => `avatar${key}`)

      authors.addNode({
        ...fields,
        id: author.id,
        title: author.name,
        avatars
      })
    }
  }

  async getTaxonomies (store) {
    const { data } = await this.fetch('wp/v2/taxonomies', {}, {})

    for (const type in data) {
      const options = data[type]
      const taxonomy = store.addContentType({
        typeName: this.createTypeName(type),
        route: this.routes[type] || `/${options.rest_base}/:slug`
      })

      this.restBases.taxonomies[type] = options.rest_base

      const terms = await this.fetchPaged(`wp/v2/${options.rest_base}`)

      for (const term of terms) {
        taxonomy.addNode({
          id: term.id,
          title: term.name,
          slug: term.slug,
          content: term.description,
          count: term.count
        })
      }
    }
  }

  extractImagesFromPostHtml (string) {
      var regex = /<img[^>]* src=\"([^\"]*)\" alt=\"([^\"]*)\"[^>]*>/gm
      
      var matches = []
      var match
      while (match = regex.exec(string)) {
          matches.push({
            url: match[1],
            alt: match[2]
          })
      }
      return matches
  }

  async downloadImage (url, destPath, fileName) {  
    const imagePath = path.resolve(destPath, fileName)
    
    try {
      if (fs.existsSync(imagePath)) {
        var fileExists = true;
      }
    } catch(err) {
      var fileExists = false;
    }
    
    if (fileExists === true) 
      return

    const writer = fs.createWriteStream(imagePath)

    try {
      const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream'
      })
      response.data.pipe(writer)

      return new Promise((resolve, reject) => {
        writer.on('finish', resolve)
        writer.on('error', reject)
      })
    }
    catch (e) {
      fs.unlinkSync(imagePath) //Cleanup blank file
      return
    }
  }

  processPostFragments (post) {
    var postImages = this.extractImagesFromPostHtml(post)

    var regex = /<img[^>]* src=\"([^\"]*)\"[^>]*>/
    var fragments = post.split(regex)

    return map(fragments, (fragment, index) => {
      var image = find(postImages, (image) => { return image.url === fragment })
      if (image) {       
        var fileName = fragment.split('/').pop()
        var imageData = {
          type: 'img',
          order: index+1,
          fragmentData: { 
            remoteUrl: fragment,
            fileName: fileName,
            image: (path.resolve('./src/assets/img/' + fileName) ),
            alt: image.alt
          }
        }
        if (this.options.downloadRemoteImagesFromPosts && this.options.postImagesLocalPath)
          this.downloadImage(
            imageData.fragmentData.remoteUrl, 
            this.options.postImagesLocalPath, 
            imageData.fragmentData.fileName
          )
        return imageData
      } else {
        return {
          type: 'html',
          order: index+1,
          fragmentData: { 
            html: fragment
          }
        }
      }
    })    
  }

  async getPosts (store) {
    const { getContentType, createReference } = store

    const AUTHOR_TYPE_NAME = this.createTypeName(TYPE_AUTHOR)
    const ATTACHEMENT_TYPE_NAME = this.createTypeName(TYPE_ATTACHEMENT)

    for (const type in this.restBases.posts) {
      const restBase = this.restBases.posts[type]
      const typeName = this.createTypeName(type)
      const posts = getContentType(typeName)

      const data = await this.fetchPaged(`wp/v2/${restBase}?_embed`)

      for (const post of data) {
        const fields = this.normalizeFields(post)
        fields.author = createReference(AUTHOR_TYPE_NAME, post.author || '0')

        if (post.type !== TYPE_ATTACHEMENT) {
          fields.featuredMedia = createReference(ATTACHEMENT_TYPE_NAME, post.featured_media)
        }

        // add references if post has any taxonomy rest bases as properties
        for (const type in this.restBases.taxonomies) {
          const propName = this.restBases.taxonomies[type]

          if (post.hasOwnProperty(propName)) {
            const typeName = this.createTypeName(type)
            const ref = createReference(typeName, post[propName])
            const key = camelCase(propName)

            fields[key] = ref
          }
        }

        if (this.options.splitPostsIntoFragments && fields['content'])
          fields.postFragments = this.processPostFragments(fields['content'])

        // download the featured image
        if (this.options.downloadRemoteFeaturedImages && this.options.featuredImagesLocalPath && post._embedded && post._embedded['wp:featuredmedia']) {
          try {
            var featuredImageFileName = post._embedded['wp:featuredmedia']['0'].source_url.split('/').pop()
            await this.downloadImage(
              post._embedded['wp:featuredmedia']['0'].source_url, 
              this.options.featuredImagesLocalPath,
              featuredImageFileName
            )
            fields.featuredMediaImage = path.resolve('./src/assets/img/' + featuredImageFileName) 
          } catch (err) {
            console.log('WARNING - No featured image for post '+post.slug) 
          }
        }

        posts.addNode({ ...fields, id: post.id })
      }
    }
  }

  async fetch (url, params = {}, fallbackData = []) {
    let res

    try {
      res = await this.client.request({ url, params })
    } catch ({ response, code, config }) {
      if (!response && code) {
        throw new Error(`${code} - ${config.url}`)
      }

      const { url } = response.config
      const { status } = response.data.data

      if ([401, 403].includes(status)) {
        console.warn(`Error: Status ${status} - ${url}`)
        return { ...response, data: fallbackData }
      } else {
        throw new Error(`${status} - ${url}`)
      }
    }

    return res
  }

  async fetchPaged (path) {
    const { perPage, concurrent } = this.options

    return new Promise(async (resolve, reject) => {
      let res

      try {
        res = await this.fetch(path, { per_page: perPage })
      } catch (err) {
        return reject(err)
      }

      const totalItems = parseInt(res.headers['x-wp-total'], 10)
      const totalPages = parseInt(res.headers['x-wp-totalpages'], 10)

      try {
        res.data = ensureArrayData(path, res.data)
      } catch (err) {
        return reject(err)
      }

      if (!totalItems || totalPages <= 1) {
        return resolve(res.data)
      }

      const queue = []

      for (let page = 2; page <= totalPages; page++) {
        queue.push({ per_page: perPage, page })
      }

      await pMap(queue, async params => {
        try {
          const { data } = await this.fetch(path, params)
          res.data.push(...ensureArrayData(path, data))
        } catch (err) {
          console.log(err.message)
        }
      }, { concurrency: concurrent })

      resolve(res.data)
    })
  }

  normalizeFields (fields) {
    const res = {}

    for (const key in fields) {
      if (key.startsWith('_')) continue // skip links and embeds etc
      res[camelCase(key)] = this.normalizeFieldValue(fields[key])
    }

    return res
  }

  normalizeFieldValue (value) {
    if (value === null) return null
    if (value === undefined) return null

    if (Array.isArray(value)) {
      return value.map(v => this.normalizeFieldValue(v))
    }

    if (isPlainObject(value)) {
      if (value.post_type && (value.ID || value.id)) {
        const typeName = this.createTypeName(value.post_type)
        const id = value.ID || value.id

        return this.store.createReference(typeName, id)
      } else if (value.filename && (value.ID || value.id)) {
        const typeName = this.createTypeName(TYPE_ATTACHEMENT)
        const id = value.ID || value.id

        return this.store.createReference(typeName, id)
      } else if (value.hasOwnProperty('rendered')) {
        return value.rendered
      }

      return this.normalizeFields(value)
    }

    return value
  }

  createTypeName (name = '') {
    return camelCase(`${this.options.typeName} ${name}`, { pascalCase: true })
  }
}

function ensureArrayData (url, data) {
  if (!Array.isArray(data)) {
    try {
      data = JSON.parse(data)
    } catch (err) {
      throw new Error(
        `Failed to fetch ${url}\n` +
        `Expected JSON response but received:\n` +
        `${data.trim().substring(0, 150)}...\n`
      )
    }
  }
  return data
}

module.exports = WordPressSource