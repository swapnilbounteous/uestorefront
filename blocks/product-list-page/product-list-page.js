// Product Discovery Dropins
import SearchResults from '@dropins/storefront-product-discovery/containers/SearchResults.js';
import Facets from '@dropins/storefront-product-discovery/containers/Facets.js';
import SortBy from '@dropins/storefront-product-discovery/containers/SortBy.js';
import Pagination from '@dropins/storefront-product-discovery/containers/Pagination.js';
import { render as provider } from '@dropins/storefront-product-discovery/render.js';
import { Button, Icon, provider as UI } from '@dropins/tools/components.js';
import { search } from '@dropins/storefront-product-discovery/api.js';
// Cart Dropin
import * as cartApi from '@dropins/storefront-cart/api.js';
import { tryRenderAemAssetsImage } from '@dropins/tools/lib/aem/assets.js';
// Event Bus
import { events } from '@dropins/tools/event-bus.js';
// AEM
import { readBlockConfig } from '../../scripts/aem.js';
import { fetchPlaceholders, getProductLink } from '../../scripts/commerce.js';

// Initializers
import '../../scripts/initializers/search.js';
import '../../scripts/initializers/wishlist.js';

export default async function decorate(block) {
  const labels = await fetchPlaceholders();

  const config = readBlockConfig(block);

  const fragment = document.createRange().createContextualFragment(`
    <div class="search__wrapper">
      <div class="search__result-info"></div>
      <div class="search__view-facets"></div>
      <div class="search__facets"></div>
      <div class="search__product-sort"></div>
      <div class="search__product-list"></div>
      <div class="search__pagination"></div>
    </div>
  `);

  const $resultInfo = fragment.querySelector('.search__result-info');
  const $viewFacets = fragment.querySelector('.search__view-facets');
  const $facets = fragment.querySelector('.search__facets');
  const $productSort = fragment.querySelector('.search__product-sort');
  const $productList = fragment.querySelector('.search__product-list');
  const $pagination = fragment.querySelector('.search__pagination');

  block.innerHTML = '';
  block.appendChild(fragment);

  // Add category url path to block for enrichment
  if (config.urlpath) {
    block.dataset.category = config.urlpath;
  }

  // Get variables from the URL
  const urlParams = new URLSearchParams(window.location.search);
  const {
    q,
    page,
    sort,
    filter,
  } = Object.fromEntries(urlParams.entries());

  const getAddToCartButton = (product) => {
    if (product.typename === 'ComplexProductView') {
      const button = document.createElement('div');
      UI.render(Button, {
        children: '',
        icon: Icon({ source: 'Cart' }),
        href: getProductLink(product.urlKey, product.sku),
        variant: 'primary',
        'aria-label': labels.Global?.AddProductToCart || 'Add to cart',
      })(button);
      return button;
    }
    const button = document.createElement('div');
    UI.render(Button, {
      children: '',
      icon: Icon({ source: 'Cart' }),
      onClick: () => cartApi.addProductsToCart([{ sku: product.sku, quantity: 1 }]),
      variant: 'primary',
      'aria-label': labels.Global?.AddProductToCart || 'Add to cart',
    })(button);
    return button;
  };

  await Promise.all([
    // Sort By
    provider.render(SortBy, {})($productSort),

    // Pagination
    provider.render(Pagination, {
      onPageChange: () => {
        // scroll to the top of the page
        window.scrollTo({ top: 0, behavior: 'smooth' });
      },
    })($pagination),

    // View Facets Button
    UI.render(Button, {
      children: labels.Global?.Filters,
      icon: Icon({ source: 'Burger' }),
      variant: 'secondary',
      onClick: () => {
        $facets.classList.toggle('search__facets--visible');
      },
    })($viewFacets),

    // Facets
    provider.render(Facets, {})($facets),
    // Product List
    provider.render(SearchResults, {
      routeProduct: (product) => getProductLink(product.urlKey, product.sku),
      slots: {
        ProductImage: (ctx) => {
          const { product, defaultImageProps } = ctx;
          const anchorWrapper = document.createElement('a');
          anchorWrapper.href = getProductLink(product.urlKey, product.sku);

          tryRenderAemAssetsImage(ctx, {
            alias: product.sku,
            imageProps: defaultImageProps,
            wrapper: anchorWrapper,
            params: {
              width: defaultImageProps.width,
              height: defaultImageProps.height,
            },
          });
        },
        ProductName: (ctx) => {
          const { product } = ctx;
          const link = getProductLink(product.urlKey, product.sku);
          const attrs = product.attributes || [];
          const getAttr = (names) => {
            const a = attrs.find((x) => names.includes((x.name || '').toLowerCase()));
            return a?.value ?? '';
          };
          const thc = getAttr(['thc', 'thc_content', 'thc_amount']);
          const brand = getAttr(['brand']);
          const weight = getAttr(['weight', 'size', 'capacity']);
          const name = product.name || product.sku || '';

          const wrap = document.createElement('div');
          wrap.className = 'product-list-page-card__content';
          const linkEl = document.createElement('a');
          linkEl.href = link;
          linkEl.className = 'product-list-page-card__link';

          if (thc) {
            const p = document.createElement('div');
            p.className = 'product-list-page-card__thc';
            p.textContent = thc;
            linkEl.appendChild(p);
          }
          if (brand) {
            const p = document.createElement('div');
            p.className = 'product-list-page-card__brand';
            p.textContent = brand;
            linkEl.appendChild(p);
          }
          const nameEl = document.createElement('div');
          nameEl.className = 'product-list-page-card__title';
          nameEl.textContent = name;
          linkEl.appendChild(nameEl);
          if (weight) {
            const p = document.createElement('div');
            p.className = 'product-list-page-card__weight';
            p.textContent = weight;
            linkEl.appendChild(p);
          }
          wrap.appendChild(linkEl);
          ctx.replaceWith(wrap);
        },
        ProductActions: (ctx) => {
          const actionsWrapper = document.createElement('div');
          actionsWrapper.className = 'product-discovery-product-actions';
          const addToCartBtn = getAddToCartButton(ctx.product);
          addToCartBtn.className = 'product-discovery-product-actions__add-to-cart';
          actionsWrapper.appendChild(addToCartBtn);
          ctx.replaceWith(actionsWrapper);
        },
      },
    })($productList),
  ]);

  // Run initial search after components are mounted so they receive search/result and stay in sync
  const baseFilter = config.urlpath ? [{ attribute: 'categoryPath', eq: config.urlpath }] : [];
  const parsedInitial = getFilterFromParams(filter || '');
  const hasCategoryInitial = parsedInitial.some((f) => f.attribute === 'categoryPath');
  const initialFilter = hasCategoryInitial ? parsedInitial : [...baseFilter, ...parsedInitial];

  if (config.urlpath) {
    await search({
      phrase: '',
      currentPage: page ? Number(page) : 1,
      pageSize: 8,
      sort: sort ? getSortFromParams(sort) : [{ attribute: 'position', direction: 'DESC' }],
      filter: initialFilter,
    }).catch(() => {
      console.error('Error searching for products');
    });
  } else {
    await search({
      phrase: q || '',
      currentPage: page ? Number(page) : 1,
      pageSize: 8,
      sort: getSortFromParams(sort),
      filter: initialFilter,
    }).catch(() => {
      console.error('Error searching for products');
    });
  }

  // Listen for search results (event is fired before the block is rendered; eager: true)
  events.on('search/result', (payload) => {
    const totalCount = payload.result?.totalCount || 0;

    block.classList.toggle('product-list-page--empty', totalCount === 0);

    // Results Info
    $resultInfo.innerHTML = payload.request?.phrase
      ? `${totalCount} results found for <strong>"${payload.request.phrase}"</strong>.`
      : `${totalCount} results found.`;

    // Update the view facets button with the number of filters
    if (payload.request.filter.length > 0) {
      $viewFacets.querySelector('button').setAttribute('data-count', payload.request.filter.length);
    } else {
      $viewFacets.querySelector('button').removeAttribute('data-count');
    }
  }, { eager: true });

  let isSyncingFromUrl = false;

  // Listen for search results (event is fired after the block is rendered; eager: false)
  events.on('search/result', (payload) => {
    const url = new URL(window.location.href);
    const req = payload.request || {};

    url.searchParams.set('q', req.phrase ?? '');
    url.searchParams.set('page', String(req.currentPage ?? 1));
    url.searchParams.set('sort', req.sort?.length ? getParamsFromSort(req.sort) : 'position_DESC');
    url.searchParams.set('filter', req.filter?.length ? getParamsFromFilter(req.filter) : '');

    const newHref = url.toString();
    if (isSyncingFromUrl || newHref === window.location.href) {
      window.history.replaceState({}, '', newHref);
    } else {
      window.history.pushState({}, '', newHref);
    }
  }, { eager: false });

  // Re-run search when URL changes (browser back/forward or external URL change)
  function runSearchFromUrl() {
    isSyncingFromUrl = true;
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q');
    const page = params.get('page');
    const sort = params.get('sort');
    const filterParam = params.get('filter');

    const baseFilter = config.urlpath
      ? [{ attribute: 'categoryPath', eq: config.urlpath }]
      : [];
    const parsedFilters = getFilterFromParams(filterParam || '');
    const hasCategoryInUrl = parsedFilters.some((f) => f.attribute === 'categoryPath');
    const filter = hasCategoryInUrl ? parsedFilters : [...baseFilter, ...parsedFilters];

    search({
      phrase: q || '',
      currentPage: page ? Number(page) : 1,
      pageSize: 8,
      sort: sort ? getSortFromParams(sort) : (config.urlpath ? [{ attribute: 'position', direction: 'DESC' }] : []),
      filter,
    }).catch(() => {
      console.error('Error searching for products');
    }).finally(() => {
      isSyncingFromUrl = false;
    });
  }

  window.addEventListener('popstate', runSearchFromUrl);

  // Accordion: make each facet header toggle its content (after facets are rendered)
  function initFacetAccordions() {
    const facetEls = block.querySelectorAll('.search__facets .product-discovery-facet');
    facetEls.forEach((facet) => {
      const header = facet.querySelector('.product-discovery-facet__header');
      if (!header || header.dataset.accordionInit) return;
      header.dataset.accordionInit = 'true';
      header.setAttribute('role', 'button');
      header.setAttribute('tabindex', '0');
      header.setAttribute('aria-expanded', 'true');
      header.classList.add('search__facet-header');
      header.addEventListener('click', (e) => {
        e.preventDefault();
        facet.classList.toggle('product-discovery-facet--collapsed');
        header.setAttribute('aria-expanded', facet.classList.contains('product-discovery-facet--collapsed') ? 'false' : 'true');
      });
      header.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          header.click();
        }
      });
    });
  }

  events.on('search/result', () => {
    setTimeout(initFacetAccordions, 0);
  }, { eager: true });
  setTimeout(initFacetAccordions, 500);
}

function getSortFromParams(sortParam) {
  if (!sortParam) return [];
  return sortParam.split(',').map((item) => {
    const [attribute, direction] = item.split('_');
    return { attribute, direction };
  });
}

function getParamsFromSort(sort) {
  return sort.map((item) => `${item.attribute}_${item.direction}`).join(',');
}

function getFilterFromParams(filterParam) {
  if (!filterParam || typeof filterParam !== 'string') return [];

  const decodedParam = decodeURIComponent(filterParam.trim());
  if (!decodedParam) return [];

  const results = [];
  const filters = decodedParam.split('|');

  filters.forEach((part) => {
    const colonIdx = part.indexOf(':');
    if (colonIdx === -1) return;
    const attribute = part.slice(0, colonIdx).trim();
    const value = part.slice(colonIdx + 1).trim();
    if (!attribute || value === undefined) return;

    if (value.includes(',')) {
      results.push({
        attribute,
        in: value.split(',').map((v) => v.trim()).filter(Boolean),
      });
    } else if (value.includes('-') && /^\d+(\.\d+)?-\d+(\.\d+)?$/.test(value)) {
      const [from, to] = value.split('-').map(Number);
      results.push({
        attribute,
        range: { from, to },
      });
    } else {
      results.push({
        attribute,
        in: [value],
      });
    }
  });

  return results;
}

function getParamsFromFilter(filter) {
  if (!filter || filter.length === 0) return '';

  return filter.map(({ attribute, eq, in: inValues, range }) => {
    if (eq != null && eq !== '') {
      return `${attribute}:${String(eq).trim()}`;
    }
    if (inValues && inValues.length) {
      return `${attribute}:${inValues.join(',')}`;
    }
    if (range != null) {
      return `${attribute}:${range.from}-${range.to}`;
    }
    return null;
  }).filter(Boolean).join('|');
}
