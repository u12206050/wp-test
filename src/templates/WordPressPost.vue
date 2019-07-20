<template>
  <Layout>
    <section class="section contents">
      <div class="container">
        <div class="columns is-centered">
          <div class="column">
            <div class="box post-content">
              
              <h1 class="title has-text-weight-bold is-size-2 is-size-3-mobile has-text-centered" v-html="$page.wordPressPost.title"/>
                <div class="has-text-centered">
                  <template v-if="$page.wordPressPost.categories.length">
                    <ul class="categories">
                      <li v-for="category in $page.wordPressPost.categories" :key="category.id" >
                        <g-link :to="category.path">
                          <span class="tag is-info">{{ category.title }}</span>
                          </g-link>
                      </li>
                    </ul>
                  </template>
                </div>

                <template v-if="$page.wordPressPost.postFragments" v-for="fragment in $page.wordPressPost.postFragments">
                    <!-- Fragment is a html block -->
                    <template v-if="fragment.type == 'html'">
                        <div v-html="fragment.fragmentData.html" class="entry-content"></div>
                    </template>

                    <!-- Fragment is a image -->
                    <template v-if="fragment.type == 'img' && fragment.fragmentData.image">
                      <div class="has-text-centered">
                        <g-image :src="fragment.fragmentData.image" :alt="fragment.fragmentData.alt"/>
                      </div>
                    </template>
                </template>

                <div class="columns">
                  <div class="column">
                    <template v-if="$page.wordPressPost.tags.length">
                      <h4 class="has-text-weight-bold">Tags</h4>
                      <ul class="tags">
                        <li v-for="tag in $page.wordPressPost.tags" :key="tag.id" >
                          <g-link :to="tag.path">
                            <span class="tag is-success">{{ tag.title }}</span>
                          </g-link>
                        </li>
                      </ul>
                    </template>
                  </div>
                </div>

            </div>
          </div>
        </div>
      </div>
    </section>
  </Layout>
</template>

<page-query>
query Post ($path: String!) {
  wordPressPost (path: $path) {
    title
    content
    featuredMediaImage
    featuredMedia {
      altText
    }
    postFragments {
        type
        fragmentData {
            image
            alt
            html
        }
    }
    categories {
      id
      title
      path
    }
    tags {
      id
      title
      path
    }
  }
}
</page-query>

<script>
export default {
  metaInfo () {
    return {
      title: this.$page.wordPressPost.title
    }
  }
}
</script>