const supabase = require('./supabaseClient');

class CreatorService {
  
  // Get creator profile
  async getCreatorProfile(userId) {
    const { data, error } = await supabase
      .from('creators')
      .select('*')
      .eq('user_id', userId)
      .single();
    
    if (error) throw error;
    return data;
  }

  // Create or update creator profile
  async upsertCreatorProfile(profileData) {
    const { data, error } = await supabase
      .from('creators')
      .upsert(profileData)
      .select();
    
    if (error) throw error;
    return data;
  }

  // Get creator earnings
  async getCreatorEarnings(creatorId) {
    const { data, error } = await supabase
      .from('creator_earnings')
      .select('*')
      .eq('creator_id', creatorId)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    const total = data.reduce((sum, e) => sum + e.net_amount, 0);
    const monthly = data.filter(e => {
      const date = new Date(e.created_at);
      const now = new Date();
      return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    }).reduce((sum, e) => sum + e.net_amount, 0);
    
    return { total, monthly, pending: 0, transactions: data };
  }

  // Get creator content
  async getCreatorContent(creatorId) {
    const { data, error } = await supabase
      .from('premium_content')
      .select('*')
      .eq('creator_id', creatorId)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data;
  }

  // Publish new content
  async publishContent(contentData) {
    const { data, error } = await supabase
      .from('premium_content')
      .insert(contentData)
      .select();
    
    if (error) throw error;
    return data;
  }

  // Update content
  async updateContent(contentId, updates) {
    const { data, error } = await supabase
      .from('premium_content')
      .update(updates)
      .eq('id', contentId)
      .select();
    
    if (error) throw error;
    return data;
  }

  // Delete content
  async deleteContent(contentId) {
    const { error } = await supabase
      .from('premium_content')
      .delete()
      .eq('id', contentId);
    
    if (error) throw error;
    return true;
  }

  // Get subscribers
  async getSubscribers(creatorId) {
    const { data, error } = await supabase
      .from('subscriptions')
      .select(`
        *,
        subscriber:subscriber_id (
          display_name,
          username,
          photo_url
        )
      `)
      .eq('creator_id', creatorId)
      .eq('is_active', true);
    
    if (error) throw error;
    return data;
  }

  // Get top creators
  async getTopCreators(limit = 10) {
    const { data, error } = await supabase
      .from('creators')
      .select(`
        *,
        total_earnings,
        total_subscribers,
        rating
      `)
      .order('total_earnings', { ascending: false })
      .limit(limit);
    
    if (error) throw error;
    return data;
  }

  // Purchase content
  async purchaseContent(contentId, userId, price) {
    // Start a transaction
    const { data: content, error: contentError } = await supabase
      .from('premium_content')
      .select('creator_id, price')
      .eq('id', contentId)
      .single();
    
    if (contentError) throw contentError;
    
    // Create access record
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days access
    
    const { data: access, error: accessError } = await supabase
      .from('content_access')
      .insert({
        content_id: contentId,
        user_id: userId,
        purchase_price: price,
        expires_at: expiresAt,
        views_remaining: 5,
        max_views: 5
      })
      .select();
    
    if (accessError) throw accessError;
    
    // Update content stats
    await supabase
      .from('premium_content')
      .update({
        total_purchases: supabase.raw('total_purchases + 1'),
        total_revenue: supabase.raw(`total_revenue + ${price}`)
      })
      .eq('id', contentId);
    
    // Create earnings record
    const platformFee = Math.floor(price * 0.2);
    const netAmount = price - platformFee;
    
    await supabase
      .from('creator_earnings')
      .insert({
        creator_id: content.creator_id,
        content_id: contentId,
        amount: price,
        platform_fee: platformFee,
        net_amount: netAmount,
        type: 'purchase',
        payer_id: userId
      });
    
    return access;
  }
}

module.exports = new CreatorService();